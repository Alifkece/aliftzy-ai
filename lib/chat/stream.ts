import type { ChatRequest, StreamingEvent } from "@/types";

export interface StreamHandlers {
  onText: (text: string) => void;
  signal: AbortSignal;
}

export type StreamResult = { ok: true; stopReason: string | null } | { ok: false; message: string };

const GENERIC = "Something went wrong. Please try again.";

function parseEvent(line: string): StreamingEvent | null {
  try {
    const v = JSON.parse(line) as StreamingEvent;
    if (v && (v.type === "text" || v.type === "done" || v.type === "error")) return v;
  } catch {
    /* ignore malformed line */
  }
  return null;
}

/** Calls /api/chat and feeds streamed text deltas to `onText`. Only the server talks to Gemini. */
export async function streamChat(request: ChatRequest, { onText, signal }: StreamHandlers): Promise<StreamResult> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    return { ok: false, message: signal.aborted ? "Stopped." : "Network error. Check your connection and try again." };
  }

  if (!res.ok || !res.body) {
    let message = GENERIC;
    if (res.status === 413) message = "File is too large.";
    else {
      try {
        const data = (await res.json()) as { error?: string };
        if (typeof data.error === "string" && data.error) message = data.error;
      } catch {
        /* keep generic */
      }
    }
    return { ok: false, message };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let stopReason: string | null | undefined;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const event = parseEvent(line);
        if (!event) continue;
        if (event.type === "text") onText(event.text);
        else if (event.type === "error") return { ok: false, message: event.message };
        else stopReason = event.stopReason;
      }
    }
  } catch {
    return { ok: false, message: signal.aborted ? "Stopped." : "The connection was interrupted. Please try again." };
  }
  // No "done" event means the connection was cut (for example by a function time limit).
  return { ok: true, stopReason: stopReason === undefined ? "interrupted" : stopReason };
}
