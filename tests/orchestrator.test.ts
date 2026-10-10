import test from "node:test";
import assert from "node:assert/strict";
import { orchestrate, classifyStop, type RunRound } from "../lib/chat/orchestrator.ts";
import { marker, parseResponse } from "../lib/chat/file-protocol.ts";
import type { StreamingEvent } from "../types/index.ts";

const T = "a1b2c3d4";
const base = [{ type: "user_input" as const, content: [{ type: "text" as const, text: "buat web" }] }];
type Script = ({ text: string; status?: string | null; completed?: boolean } | { throw: { status?: number; message: string } })[];

function run(script: Script) {
  const calls: { steps: any[] }[] = [];
  const runRound: RunRound = async (steps, _s, onText) => {
    const item = script[calls.length];
    calls.push({ steps });
    if (!item) throw Object.assign(new Error("script exhausted"), { status: 400 });
    if ("throw" in item) throw Object.assign(new Error(item.throw.message), { status: item.throw.status });
    for (let i = 0; i < item.text.length; i += 7) onText(item.text.slice(i, i + 7)); // small chunks
    return { status: item.status === undefined ? "completed" : item.status, sawCompleted: item.completed ?? true };
  };
  const events: StreamingEvent[] = [];
  const go = (ac = new AbortController(), limits = {}) =>
    orchestrate({
      baseSteps: base, token: T, signal: ac.signal, runRound, send: (e) => events.push(e), limits: { backoffMs: [0], holdBackChars: 400, ...limits },
      describeError: (e: any) => ({ message: e.message, transient: e.status === 429 || e.status >= 500 }), sleep: async () => {},
    });
  // Client view of the text, exactly as use-chat applies events.
  const view = () => events.reduce((acc, e) => (e.type === "text" ? acc + e.text : e.type === "replace" ? e.text : acc), "");
  return { go, calls, events, view };
}
const file = (p: string, body: string) => `${marker.file(T, "html", p)}\n${body}\n${marker.end(T)}\n`;

test("normal answer: one round, done", async () => {
  const s = run([{ text: `${marker.plan(T, ["index.html"])}\nok\n${file("index.html", "<h1>x</h1>")}Selesai.` }]);
  const r = await s.go();
  assert.equal(r.outcome, "complete");
  assert.equal(s.calls.length, 1);
  assert.equal(s.events.at(-1)?.type, "done");
});

test("cut by token limit inside a file: continues that exact file, no duplication, no Continue needed", async () => {
  const body = Array.from({ length: 30 }, (_, i) => `<p>line number ${i}</p>`).join("\n");
  const full = `${marker.file(T, "html", "index.html")}\n${body}\n${marker.end(T)}\nSelesai.`;
  const cut = full.indexOf("line number 20") + 6;
  const rest = full.slice(cut);
  // The model repeats a few already-written lines before continuing (overlap).
  const overlapStart = full.lastIndexOf("<p>line number 18", cut);
  const s = run([{ text: full.slice(0, cut), status: "incomplete" }, { text: full.slice(overlapStart, cut) + rest }]);
  const r = await s.go();
  assert.equal(r.outcome, "complete");
  assert.equal(s.calls.length, 2);
  assert.equal(s.view(), full);
  assert.equal(r.produced, full);
  const p = parseResponse(r.produced, { final: true });
  assert.equal(p.files.length, 1);
  assert.ok(p.files[0].isComplete);
  const prompt = s.calls[1].steps.at(-1).content[0].text as string;
  assert.match(prompt, /index\.html/);
  assert.match(prompt, /do not repeat/i);
  assert.equal(s.calls[1].steps.at(-2).type, "model_output");
});

test("status says completed but a file has no END: asks to confirm/continue instead of calling it final", async () => {
  const s = run([{ text: `${marker.file(T, "js", "a.js")}\nlet a = 1;\n` }, { text: marker.end(T) }]);
  const r = await s.go();
  assert.equal(r.outcome, "complete");
  assert.equal(s.calls.length, 2);
  const p = parseResponse(r.produced, { final: true });
  assert.ok(p.files[0].isComplete);
  assert.equal(p.files[0].content, "let a = 1;\n");
});

test("continuation cut mid-line joins END marker on its own line", async () => {
  const s = run([{ text: `${marker.file(T, "js", "a.js")}\nlet a = 1;`, status: "max_tokens" }, { text: marker.end(T) }]);
  const r = await s.go();
  assert.ok(parseResponse(r.produced, { final: true }).files[0].isComplete);
});

test("missing planned file triggers a targeted round", async () => {
  const s = run([
    { text: `${marker.plan(T, ["a.html", "b.css"])}\n${file("a.html", "A")}` },
    { text: file("b.css", "B") },
  ]);
  const r = await s.go();
  assert.equal(r.outcome, "complete");
  assert.match(s.calls[1].steps.at(-1).content[0].text, /b\.css/);
  const p = parseResponse(r.produced, { final: true });
  assert.deepEqual(p.files.map((f) => f.path), ["a.html", "b.css"]);
});

test("restart of the open file replaces the draft instead of duplicating", async () => {
  const s = run([{ text: `${marker.file(T, "js", "a.js")}\nhalf`, status: "length" }, { text: `${marker.file(T, "js", "a.js")}\nwhole\n${marker.end(T)}\n` }]);
  const r = await s.go();
  const p = parseResponse(r.produced, { final: true });
  assert.equal(p.files.length, 1);
  assert.equal(p.files[0].content, "whole\n");
  assert.ok(!s.view().includes("half"));
});

test("connection cut (no completed event) is continued; transient provider error retried", async () => {
  const s = run([
    { text: `${marker.file(T, "js", "a.js")}\nabc\n`, status: null, completed: false },
    { throw: { status: 503, message: "unavailable" } },
    { text: `def\n${marker.end(T)}\n` },
  ]);
  const r = await s.go();
  assert.equal(r.outcome, "complete");
  assert.equal(s.calls.length, 3);
  assert.equal(parseResponse(r.produced, { final: true }).files[0].content, "abc\ndef\n");
  assert.ok(s.events.some((e) => e.type === "progress"));
});

test("provider error: honest error event, partial output kept, never reported complete", async () => {
  const s = run([{ text: `${marker.file(T, "js", "a.js")}\npartial`, status: "length" }, { throw: { status: 400, message: "bad request" } }]);
  const r = await s.go();
  assert.equal(r.outcome, "failed");
  assert.equal(s.events.at(-1)?.type, "error");
  assert.ok(!s.events.some((e) => e.type === "done"));
  assert.ok(s.view().includes("partial"));
  assert.match((s.events.at(-1) as any).message, /a\.js/);
});

test("provider refusal stops without continuing", async () => {
  const s = run([{ text: "x".repeat(50), status: "blocked_safety" }]);
  const r = await s.go();
  assert.equal(r.outcome, "failed");
  assert.equal(s.calls.length, 1);
});

test("endless truncation is bounded by max rounds / stall guard", async () => {
  const script: Script = Array.from({ length: 30 }, (_, i) => ({ text: `${i === 0 ? marker.file(T, "js", "a.js") + "\n" : ""}chunk-${i}-${"y".repeat(60)}\n`, status: "length" }));
  const s = run(script);
  const r = await s.go(new AbortController(), { maxRounds: 4 });
  assert.equal(r.outcome, "failed");
  assert.equal(s.calls.length, 4);
  const stall = run(Array.from({ length: 10 }, () => ({ text: "", status: "length" })));
  const r2 = await stall.go();
  assert.equal(r2.outcome, "failed");
  assert.ok(stall.calls.length <= 3);
});

test("user abort: cancelled, no error, no done", async () => {
  const ac = new AbortController();
  const runRound: RunRound = async (_s, _sig, onText) => { onText("abc"); ac.abort(); return { status: null, sawCompleted: false }; };
  const events: StreamingEvent[] = [];
  const r = await orchestrate({ baseSteps: base, token: T, signal: ac.signal, runRound, send: (e) => events.push(e), describeError: () => ({ message: "", transient: false }) });
  assert.equal(r.outcome, "cancelled");
  assert.ok(!events.some((e) => e.type === "error" || e.type === "done"));
});

test("plain conversation cut by length continues without file logic", async () => {
  const s = run([{ text: "Penjelasan panjang yang terpotong di tengah kali", status: "length" }, { text: "mat dan selesai." }]);
  const r = await s.go();
  assert.equal(r.outcome, "complete");
  assert.equal(r.produced, "Penjelasan panjang yang terpotong di tengah kalimat dan selesai.");
});

test("stop status classification", () => {
  assert.equal(classifyStop("completed", true), "complete");
  assert.equal(classifyStop("incomplete", true), "length");
  assert.equal(classifyStop(null, false), "interrupted");
  assert.equal(classifyStop("something_new", true), "unknown");
  assert.equal(classifyStop("failed", true), "failed");
});
