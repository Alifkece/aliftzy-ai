import { getClient } from "@/lib/gemini/client";
import { getMaxOutputTokens, getModel, getThinkingLevel, hasApiKey } from "@/lib/gemini/config";
import { MISSING_KEY_MESSAGE, toSafeError } from "@/lib/gemini/errors";
import { buildSteps } from "@/lib/gemini/build-input";
import { ValidationError, validateChatRequest } from "@/lib/gemini/validate";
import { LIMITS } from "@/lib/files/rules";
import type { StreamingEvent } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
// Run close to Indonesian users (Singapore) instead of the default US region: much lower latency.
export const preferredRegion = "sin1";

const SYSTEM_PROMPT = [
  "You are the assistant inside the chat app Aliftzy Codes AI. Be helpful, precise and honest. Answer in the user's language. Be concise: no filler, no long introductions.",
  "Use Markdown. Put all code in fenced code blocks with a language tag.",
  "When you write files (a website, a script, a project), give each file complete in its own fenced block and label it with its file name, for example ```html title=\"index.html\" or ```css title=\"css/style.css\". Never abbreviate a file with placeholders like '...rest of the code'.",
  "This app shows a Download button on every code block and a Download ZIP button under answers that contain several files. If the user asks for a file or a zip, provide the files in labeled blocks and tell them to use those buttons. Never say that you cannot create or send files.",
].join("\n");

type Upstream = AsyncIterable<unknown> & { controller?: { abort?: () => void } };

/** Shape of the streaming events we read (documented: event_type, delta.type/text, error.message). */
interface RawEvent {
  event_type?: string;
  delta?: { type?: string; text?: string };
  error?: { message?: string; code?: number | string };
  status?: string;
  interaction?: { status?: string };
}

function json(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  if (!hasApiKey()) return json(500, MISSING_KEY_MESSAGE);

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > LIMITS.maxRequestBytes) return json(413, "File is too large.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, "Invalid request.");
  }

  let steps;
  try {
    steps = buildSteps(validateChatRequest(body).messages);
  } catch (err) {
    if (err instanceof ValidationError) return json(400, err.message);
    return json(400, "Invalid request.");
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: StreamingEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      let upstream: Upstream | null = null;
      req.signal.addEventListener(
        "abort",
        () => {
          // Stop button -> client aborts fetch -> stop reading and, if the SDK exposes it, cancel upstream.
          try {
            upstream?.controller?.abort?.();
          } catch {
            /* best effort */
          }
        },
        { once: true },
      );

      try {
        // Same call as the reference: ai.interactions.create({ model, input }), plus streaming.
        // Stateless: the full history is sent as steps and nothing is stored (store: false).
        // The params object is cast because the SDK's generated types are stricter than the
        // documented JSON shape we build in lib/gemini/build-input.ts.
        const params = {
          model: getModel(),
          input: steps,
          system_instruction: SYSTEM_PROMPT,
          generation_config: { max_output_tokens: getMaxOutputTokens(), thinking_level: getThinkingLevel() },
          store: false,
          stream: true,
        };
        const startedAt = Date.now();
        let firstTokenMs = 0;
        let chars = 0;
        let status: string | null = null;
        const seen: Record<string, number> = {};

        upstream = (await getClient().interactions.create(params as never)) as unknown as Upstream;

        for await (const raw of upstream) {
          if (req.signal.aborted) break;
          const event = raw as RawEvent;
          const kind = `${event.event_type ?? "?"}${event.delta?.type ? ":" + event.delta.type : ""}`;
          seen[kind] = (seen[kind] ?? 0) + 1;
          if (event.event_type === "step.delta" && event.delta?.type === "text" && typeof event.delta.text === "string") {
            if (!firstTokenMs) firstTokenMs = Date.now() - startedAt;
            chars += event.delta.text.length;
            send({ type: "text", text: event.delta.text });
          } else if (event.event_type === "interaction.status_update" && typeof event.status === "string") {
            status = event.status;
          } else if (event.event_type === "interaction.completed") {
            if (typeof event.interaction?.status === "string") status = event.interaction.status;
          } else if (event.event_type === "error") {
            const code = Number(event.error?.code);
            throw Object.assign(new Error(event.error?.message ?? ""), { status: Number.isFinite(code) ? code : undefined });
          }
        }
        // Timing only (no content): visible in Vercel → Logs to see where the time goes.
        console.info("[api/chat] finished", { firstTokenMs, totalMs: Date.now() - startedAt, chars, status, events: seen });
        if (!req.signal.aborted) send({ type: "done", stopReason: status });
      } catch (err) {
        if (!req.signal.aborted) {
          // Visible in Vercel → Logs. Status and type only; never the key or request body.
          const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : "n/a";
          console.error("[api/chat] upstream error", { status, name: err instanceof Error ? err.name : typeof err });
          send({ type: "error", message: toSafeError(err).message });
        }
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
