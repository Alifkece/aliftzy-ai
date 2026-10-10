/**
 * Generation orchestrator (server side).
 *
 * One provider response is never assumed to be the finished job. After every round the orchestrator
 * decides, from the provider's stop status AND from the structure of what was written, whether the
 * work is complete, must be continued, or has failed:
 *
 *   complete    status normal, no file left open, every planned file written, no unbalanced fence
 *   continue    stopped by length / connection cut / transient error / file left open / planned file missing
 *   fail        provider refused or failed, retries exhausted, no progress, time budget spent
 *   cancelled   the user pressed Stop
 *
 * Continuation is stateless and precise: the text received so far is replayed as the model's own turn
 * and the follow-up instruction names the exact file that is open (or the files still missing).
 * The continuation is stitched on with overlap removal, so nothing is duplicated and nothing is invented.
 * On failure everything received is kept (the client keeps it as a draft) and an honest error is sent.
 */
import type { StreamingEvent } from "../../types";
import type { Step } from "../gemini/build-input";
import {
  compactResponse,
  hasUnclosedFence,
  joinContinuation,
  marker,
  parseResponse,
  startsWithFileMarker,
  stripContinuationFence,
  stripPartialMarker,
  trimOverlap,
} from "./file-protocol";

export type StopKind = "complete" | "length" | "interrupted" | "failed" | "refused" | "cancelled" | "unknown";

/** Maps the provider status string. Unknown vocabulary is never guessed as "complete". */
export function classifyStop(status: string | null, sawCompleted: boolean): StopKind {
  const s = (status ?? "").toLowerCase();
  if (/(safety|block|prohibit|recitation|refus|filter|policy)/.test(s)) return "refused";
  if (/(incomplete|max[_ -]?tokens?|length|truncat|token)/.test(s)) return "length";
  if (/(fail|error)/.test(s)) return "failed";
  if (/(cancel|abort)/.test(s)) return "cancelled";
  if (/^(completed|complete|done|stop|succeeded|success)$/.test(s)) return "complete";
  if (!sawCompleted) return "interrupted";
  return "unknown";
}

export interface RoundResult {
  status: string | null;
  sawCompleted: boolean;
}

export type RunRound = (steps: Step[], signal: AbortSignal, onText: (text: string) => void) => Promise<RoundResult>;

export interface OrchestratorLimits {
  maxRounds: number;
  maxTransientRetries: number;
  deadlineMs: number;
  stallLimit: number;
  minProgressChars: number;
  holdBackChars: number;
  backoffMs: number[];
}

export const DEFAULT_LIMITS: OrchestratorLimits = {
  maxRounds: 8,
  maxTransientRetries: 3,
  deadlineMs: 270_000, // route maxDuration is 300s
  stallLimit: 2,
  minProgressChars: 20,
  holdBackChars: 3000, // must be >= the overlap window of trimOverlap
  backoffMs: [1500, 4000, 8000],
};

export interface OrchestratorOptions {
  baseSteps: Step[];
  token: string;
  signal: AbortSignal;
  runRound: RunRound;
  send: (event: StreamingEvent) => void;
  /** Maps a thrown provider error to a safe message and tells whether retrying can help. */
  describeError: (err: unknown) => { message: string; transient: boolean };
  limits?: Partial<OrchestratorLimits>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface OrchestratorResult {
  outcome: "complete" | "failed" | "cancelled";
  produced: string;
  rounds: number;
  reason?: string;
}

const text = (t: string) => [{ type: "text" as const, text: t }];

function tailLines(s: string, maxLines = 12, maxChars = 700): string {
  const lines = s.split("\n").slice(-maxLines).join("\n");
  return lines.length > maxChars ? lines.slice(-maxChars) : lines;
}

/** The follow-up instruction, chosen from what is actually missing. Exported for tests. */
export function buildContinuationPrompt(produced: string, token: string): string {
  const p = parseResponse(produced, { final: true });
  const missing = p.missingPlanned.filter((m) => !p.openFile || p.openFile.path !== m);
  const rest = missing.length
    ? ` After that, write the planned files that are still missing (${missing.join(", ")}), each one complete, using the same file markers.`
    : "";
  if (p.openFile) {
    return [
      `Your previous reply stopped while writing the file "${p.openFile.path}" (it has no end marker yet). The last lines written were:`,
      "<<<TAIL",
      tailLines(p.openFile.content),
      "TAIL>>>",
      "Continue from exactly the next character after that text. Output ONLY the remaining content of this file: do not repeat lines that are already written, do not restart the file, do not use code fences, and add no commentary.",
      `When the file is complete, write ${marker.end(token)} on its own line. If the file was already complete, reply with only ${marker.end(token)}.${rest}`,
    ].join("\n");
  }
  if (p.brokenFiles.length) {
    return `These files were left unfinished: ${p.brokenFiles.map((f) => f.path).join(", ")}. Write each of them again from the beginning, complete, using ${marker.file(token, "<language>", "<path>")} and ${marker.end(token)} markers. Do not repeat files that are already finished.${rest}`;
  }
  if (missing.length) {
    return `These planned files have not been written yet: ${missing.join(", ")}. Write each one complete using ${marker.file(token, "<language>", "<path>")} and ${marker.end(token)} markers. Do not repeat files that are already finished.`;
  }
  return "Your previous reply was cut off. Continue exactly where it stopped, without repeating anything and without a preamble. If you were inside a code block, keep going inside it.";
}

/** What is still wrong with the produced text? Empty array = structurally complete. */
export function structuralProblems(produced: string): string[] {
  const p = parseResponse(produced, { final: true });
  const out: string[] = [];
  if (p.openFile) out.push(`file ${p.openFile.path} has no end marker`);
  for (const f of p.brokenFiles) out.push(`file ${f.path} is incomplete`);
  for (const m of p.missingPlanned) if (!p.openFile || p.openFile.path !== m) out.push(`planned file ${m} was not written`);
  if (hasUnclosedFence(p.prose)) out.push("a code block was left open");
  return out;
}

export async function orchestrate(opts: OrchestratorOptions): Promise<OrchestratorResult> {
  const L: OrchestratorLimits = { ...DEFAULT_LIMITS, ...opts.limits };
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const startedAt = now();
  const { send, token } = opts;

  let produced = "";
  let rounds = 0;
  let stalls = 0;
  let transient = 0;
  let lastReason = "";

  const fail = (reason: string): OrchestratorResult => {
    send({ type: "error", message: reason });
    return { outcome: "failed", produced, rounds, reason };
  };

  for (;;) {
    if (opts.signal.aborted) return { outcome: "cancelled", produced, rounds };
    const remaining = L.deadlineMs - (now() - startedAt);
    if (remaining <= 0) return fail(`Generation took too long and was stopped safely. ${describeDraft(produced)}`);

    rounds += 1;
    const continuing = produced.length > 0;
    const steps: Step[] = continuing
      ? [...opts.baseSteps, { type: "model_output", content: text(produced) }, { type: "user_input", content: text(buildContinuationPrompt(produced, token)) }]
      : opts.baseSteps;

    // Per-round controller: user abort OR time budget.
    const ctrl = new AbortController();
    let timedOut = false;
    const onAbort = () => ctrl.abort();
    opts.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, remaining);

    const before = produced.length;
    let held = "";
    let holding = continuing;
    const open = continuing ? parseResponse(produced, { final: true }) : null;

    const emitContinuation = (chunk: string) => {
      // Decide how this round's first text is stitched onto what exists.
      let next = chunk;
      const restart = startsWithFileMarker(next);
      if (restart && open?.openFile && open.openBlock && restart.path === open.openFile.path) {
        // The model re-wrote the open file from the top: drop the unfinished draft, keep the fresh version.
        produced = produced.slice(0, open.openBlock.start);
        send({ type: "replace", text: produced });
      } else {
        produced = stripPartialMarker(produced);
        if (produced.length !== before) send({ type: "replace", text: produced });
        if (open?.openFile) next = stripContinuationFence(next);
        next = trimOverlap(produced, next);
        next = joinContinuation(produced, next).slice(produced.length);
      }
      if (next) {
        produced += next;
        send({ type: "text", text: next });
      }
    };

    const onText = (t: string) => {
      if (!holding) {
        produced += t;
        send({ type: "text", text: t });
        return;
      }
      held += t;
      if (held.length >= L.holdBackChars) {
        holding = false;
        emitContinuation(held);
        held = "";
      }
    };

    let result: RoundResult | null = null;
    let error: { message: string; transient: boolean } | null = null;
    try {
      result = await opts.runRound(steps, ctrl.signal, onText);
    } catch (err) {
      error = opts.describeError(err);
    } finally {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onAbort);
    }
    if (holding && held) {
      holding = false;
      emitContinuation(held);
      held = "";
    }

    if (opts.signal.aborted) return { outcome: "cancelled", produced, rounds };
    if (timedOut) return fail(`Generation took too long and was stopped safely. ${describeDraft(produced)}`);

    let kind: StopKind;
    if (error) {
      if (!error.transient) return fail(`${error.message} ${describeDraft(produced)}`.trim());
      if (transient >= L.maxTransientRetries) return fail(`The AI provider kept failing (${error.message}). ${describeDraft(produced)}`);
      transient += 1;
      send({ type: "progress", message: `Connection problem, retrying (${transient}/${L.maxTransientRetries})…` });
      await sleep(L.backoffMs[Math.min(transient - 1, L.backoffMs.length - 1)]);
      kind = "interrupted";
      lastReason = error.message;
    } else {
      kind = classifyStop(result!.status, result!.sawCompleted);
      lastReason = result!.status ?? kind;
    }

    if (kind === "refused" || kind === "failed" || kind === "cancelled") {
      return fail(`The AI provider stopped the generation (${lastReason}). ${describeDraft(produced)}`);
    }

    const problems = structuralProblems(produced);
    const needsMore = kind === "length" || kind === "interrupted" || problems.length > 0;
    if (!needsMore) {
      const compact = compactResponse(produced);
      if (compact !== produced) {
        produced = compact;
        send({ type: "replace", text: produced });
      }
      send({ type: "done", stopReason: result?.status ?? null, rounds });
      return { outcome: "complete", produced, rounds };
    }

    if (produced.length - before < L.minProgressChars) stalls += 1;
    else stalls = 0;
    if (stalls >= L.stallLimit) return fail(`The AI provider made no progress (${problems[0] ?? lastReason}). ${describeDraft(produced)}`);
    if (rounds >= L.maxRounds) {
      return fail(`The answer could not be finished within ${L.maxRounds} attempts (${problems[0] ?? lastReason}). ${describeDraft(produced)}`);
    }
    send({ type: "progress", message: `Continuing automatically (${rounds + 1}/${L.maxRounds})…` });
  }
}

function describeDraft(produced: string): string {
  if (!produced) return "Nothing was received. Use Retry to start again.";
  const p = parseResponse(produced, { final: true });
  const bad = [...(p.openFile ? [p.openFile] : []), ...p.brokenFiles].map((f) => f.path);
  const done = p.files.filter((f) => f.isComplete).length;
  const part = bad.length ? ` Unfinished: ${bad.join(", ")} (kept as a draft, not downloadable).` : "";
  return `${done} file(s) were finished and kept.${part} Use Retry to start again.`;
}
