import { getClient } from "@/lib/gemini/client";
import { getMaxOutputTokens, getModel, getThinkingLevel, hasApiKey } from "@/lib/gemini/config";
import { MISSING_KEY_MESSAGE, isTransientError, toSafeError } from "@/lib/gemini/errors";
import { detectIntent, type Intent } from "@/lib/chat/intent";
import { marker, newToken, renormalizeMarkers } from "@/lib/chat/file-protocol";
import { orchestrate, type RunRound } from "@/lib/chat/orchestrator";
import { buildSteps } from "@/lib/gemini/build-input";
import { ValidationError, validateChatRequest } from "@/lib/gemini/validate";
import { LIMITS } from "@/lib/files/rules";
import type { StreamingEvent } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
// Run close to Indonesian users (Singapore) instead of the default US region: much lower latency.
export const preferredRegion = "sin1";

/**
 * Files are written between marker lines carrying a per-request token (see lib/chat/file-protocol.ts), not in
 * Markdown fences: the app can then tell exactly which file is open, finished or missing, continue a cut-off
 * file automatically, and build real downloads and ZIPs from structured data.
 */
function buildSystemPrompt(token: string, intent: Intent): string {
  const lines = [
    "You are the assistant inside the chat app Aliftzy Codes AI. Be helpful, precise and honest. Answer in the user's language. Be concise: no filler, no long introductions.",
    "For normal questions and conversation, answer in Markdown. Short snippets and examples go in fenced code blocks with a language tag. Do NOT create files unless the user asks for a file, website, app, script, project, or an edit of their files.",
    "",
    "FILE OUTPUT PROTOCOL (use it whenever you write or edit files):",
    `Start with one line listing every file you will write: ${marker.plan(token, ["index.html", "css/style.css"])}`,
    "Then write each file like this. Marker lines stand alone on their own line, starting in column 1:",
    marker.file(token, "<language>", "<relative/path/file.ext>"),
    "<the complete raw content of the file>",
    marker.end(token),
    "Rules:",
    "- Use exactly the token above in every marker. Never put marker lines, Markdown fences or explanations inside a file. Normal code comments are fine.",
    "- Every file must be complete and runnable. Never abbreviate with placeholders such as '...rest of the code'.",
    "- Use relative paths with real folders (css/style.css, js/app.js, components/navbar.html) and the exact file names the user asked for. For a website, write separate HTML, CSS and JS files unless the user asks for a single file; a single HTML file means one complete file with inline CSS/JS.",
    "- Do not repeat file contents in your prose. The app shows each file as a card with Preview, Copy and Download, and builds ZIP downloads itself. Before the files write one or two sentences; after the files write a short summary of what you did. Never say you cannot create or send files, and never claim anything was uploaded to GitHub.",
    "- Editing: files the user attached and files you wrote earlier in this conversation are the source of truth. Keep everything unrelated unchanged. Write a file only if it is new or really changed, always with its complete new content (no diffs, no patches). To delete a file, write " + marker.del(token, "<path>") + " on its own line instead of deleting it silently.",
    "- Never put API keys, tokens or .env contents in files; use placeholders and a .env.example if configuration is needed.",
    "- If the job is large, order the files by importance and finish each one completely before starting the next. If you are cut off you will be asked to continue; continue exactly where you stopped.",
  ];
  if (intent.zip) lines.push("- The user asked for a ZIP: write every file the project needs with the markers above. The app packages them into a real ZIP; do not explain how to zip.");
  if (intent.changedOnly) lines.push("- The user wants ONLY the files that changed: write only new or really modified files (complete content) and list deletions with the delete marker. Do not write unchanged files.");
  return lines.join("\n");
}

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

  const token = newToken();
  let steps;
  let intent: Intent = { zip: false, changedOnly: false };
  try {
    const messages = validateChatRequest(body).messages.map((m) => (m.role === "assistant" ? { ...m, content: renormalizeMarkers(m.content, token) } : m));
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    intent = detectIntent(lastUser?.content ?? "");
    steps = buildSteps(messages);
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

      const systemPrompt = buildSystemPrompt(token, intent);
      const startedAt = Date.now();

      // One provider round. Same call as before: ai.interactions.create({ model, input }) with streaming and
      // stateless history (store: false). The params object is cast because the SDK's generated types are
      // stricter than the documented JSON shape built in lib/gemini/build-input.ts.
      const runRound: RunRound = async (roundSteps, signal, onText) => {
        const params = {
          model: getModel(),
          input: roundSteps,
          system_instruction: systemPrompt,
          generation_config: { max_output_tokens: getMaxOutputTokens(), thinking_level: getThinkingLevel() },
          store: false,
          stream: true,
        };
        let status: string | null = null;
        let sawCompleted = false;
        let firstTokenMs = 0;
        let chars = 0;
        const seen: Record<string, number> = {};
        const roundStart = Date.now();

        const upstream = (await getClient().interactions.create(params as never)) as unknown as Upstream;
        const abortUpstream = () => {
          try {
            upstream.controller?.abort?.();
          } catch {
            /* best effort */
          }
        };
        if (signal.aborted) abortUpstream();
        signal.addEventListener("abort", abortUpstream, { once: true });
        try {
          for await (const raw of upstream) {
            if (signal.aborted) break;
            const event = raw as RawEvent;
            const kind = `${event.event_type ?? "?"}${event.delta?.type ? ":" + event.delta.type : ""}`;
            seen[kind] = (seen[kind] ?? 0) + 1;
            if (event.event_type === "step.delta" && event.delta?.type === "text" && typeof event.delta.text === "string") {
              if (!firstTokenMs) firstTokenMs = Date.now() - roundStart;
              chars += event.delta.text.length;
              onText(event.delta.text);
            } else if (event.event_type === "interaction.status_update" && typeof event.status === "string") {
              status = event.status;
            } else if (event.event_type === "interaction.completed") {
              sawCompleted = true;
              if (typeof event.interaction?.status === "string") status = event.interaction.status;
            } else if (event.event_type === "error") {
              const code = Number(event.error?.code);
              throw Object.assign(new Error(event.error?.message ?? ""), { status: Number.isFinite(code) ? code : undefined });
            }
          }
        } finally {
          signal.removeEventListener("abort", abortUpstream);
        }
        // Timing and status only (no content): visible in Vercel → Logs.
        console.info("[api/chat] round finished", { firstTokenMs, totalMs: Date.now() - roundStart, chars, status, sawCompleted, events: seen });
        return { status, sawCompleted };
      };

      try {
        const result = await orchestrate({
          baseSteps: steps,
          token,
          signal: req.signal,
          runRound,
          send,
          describeError: (err) => {
            // Status and type only; never the key or request body.
            const st = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : "n/a";
            console.error("[api/chat] upstream error", { status: st, name: err instanceof Error ? err.name : typeof err });
            return { message: toSafeError(err).message, transient: isTransientError(err) };
          },
        });
        console.info("[api/chat] finished", { outcome: result.outcome, rounds: result.rounds, chars: result.produced.length, totalMs: Date.now() - startedAt });
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("[api/chat] unexpected error", { name: err instanceof Error ? err.name : typeof err });
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
