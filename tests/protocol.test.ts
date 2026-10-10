import test from "node:test";
import assert from "node:assert/strict";
import {
  parseResponse, marker, compactResponse, trimOverlap, stripPartialMarker, joinContinuation,
  stripContinuationFence, renormalizeMarkers, normalizePath, safeFilename, exclusionReason, findSecret, newToken,
} from "../lib/chat/file-protocol.ts";

const T = "a1b2c3d4";
const file = (p: string, l: string, body: string) => `${marker.file(T, l, p)}\n${body}\n${marker.end(T)}\n`;

test("parses plan, files, prose and keeps content byte-exact", () => {
  const body = `<p>Halo "dunia" \`x\` 🚀 é</p>\n\tindent  \n`;
  const text = `Ini situsnya.\n${marker.plan(T, ["index.html", "css/a.css"])}\n${file("index.html", "html", body)}${file("css/a.css", "css", "a{}")}Selesai.`;
  const r = parseResponse(text, { final: true });
  assert.deepEqual(r.plan, ["index.html", "css/a.css"]);
  assert.equal(r.files.length, 2);
  assert.equal(r.files[0].content, body + "\n");
  assert.ok(r.files.every((f) => f.isComplete && f.status === "complete"));
  assert.equal(r.openFile, null);
  assert.deepEqual(r.missingPlanned, []);
  assert.match(r.prose, /Ini situsnya\./);
  assert.match(r.prose, /Selesai\./);
  assert.ok(!r.prose.includes("@@"));
});

test("code fences and look-alike markers inside a file stay file content", () => {
  const body = "```js\nconsole.log(1)\n```\n@@END[ffffffff]@@\n@@FILE[ffffffff]|x|y.txt@@\n";
  const r = parseResponse(file("README.md", "markdown", body), { final: true });
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].content, body + "\n");
  assert.ok(r.files[0].isComplete);
});

test("same file name in different folders does not collide", () => {
  const r = parseResponse(file("a/index.html", "html", "A") + file("b/index.html", "html", "B"), { final: true });
  assert.deepEqual(r.files.map((f) => [f.path, f.content.trim()]), [["a/index.html", "A"], ["b/index.html", "B"]]);
  assert.notEqual(r.files[0].id, r.files[1].id);
});

test("open file while streaming is 'writing', after final it is 'incomplete'", () => {
  const text = `${marker.file(T, "js", "js/app.js")}\nlet a = 1;\nlet b`;
  const live = parseResponse(text, { final: false });
  assert.equal(live.files[0].status, "writing");
  assert.equal(live.files[0].isComplete, false);
  assert.ok(live.openFile);
  const fin = parseResponse(text, { final: true });
  assert.equal(fin.files[0].status, "incomplete");
  assert.equal(fin.files[0].content, "let a = 1;\nlet b");
});

test("a partial marker at the end of a live stream is hidden, not shown as text or content", () => {
  const live = parseResponse(`Hai\n${file("a.txt", "text", "x")}@@FI`, { final: false });
  assert.ok(!live.prose.includes("@@"));
  const inFile = parseResponse(`${marker.file(T, "text", "a.txt")}\nabc\n@@EN`, { final: false });
  assert.equal(inFile.files[0].content, "abc\n");
});

test("file cut by another marker is broken; a later complete version supersedes it", () => {
  const text = `${marker.file(T, "js", "x.js")}\npartial\n${file("x.js", "js", "full")}`;
  const r = parseResponse(text, { final: true });
  assert.equal(r.files.length, 1);
  assert.ok(r.files[0].isComplete);
  assert.equal(r.files[0].content.trim(), "full");
  assert.equal(r.brokenFiles.length, 0);
  assert.ok(!compactResponse(text).includes("partial"));
  const broken = parseResponse(`${marker.file(T, "js", "x.js")}\npartial\n${file("y.js", "js", "ok")}`, { final: true });
  assert.equal(broken.brokenFiles.length, 1);
  assert.equal(broken.brokenFiles[0].path, "x.js");
});

test("missing planned files and deletions are reported", () => {
  const r = parseResponse(`${marker.plan(T, ["a.js", "b.js"])}\n${file("a.js", "js", "1")}${marker.del(T, "old.js")}\n`, { final: true });
  assert.deepEqual(r.missingPlanned, ["b.js"]);
  assert.deepEqual(r.deleted, ["old.js"]);
});

test("plain conversation produces no files", () => {
  const r = parseResponse("Halo! Berikut penjelasannya:\n```js\nlet a\n```", { final: true });
  assert.equal(r.files.length, 0);
  assert.equal(r.segments.length, 1);
});

test("path sanitizing blocks traversal and unsafe names", () => {
  assert.equal(normalizePath("../../etc/passwd"), "etc/passwd");
  assert.equal(normalizePath("/abs/x.js"), "abs/x.js");
  assert.equal(normalizePath("C:\\a\\b.txt"), "a/b.txt");
  assert.equal(normalizePath('"./css/style.css"'), "css/style.css");
  assert.equal(safeFilename("dir/CON.txt"), "_CON.txt");
});

test("overlap trimming, fence stripping, joining", () => {
  const existing = "function a() {\n  return 1;\n}\nfunction b() {\n  const x = 10;\n";
  const next = "function b() {\n  const x = 10;\n  return x;\n}\n";
  assert.equal(trimOverlap(existing, next), "  return x;\n}\n");
  assert.equal(trimOverlap("abc\n", "}\n"), "}\n"); // short repeats are not trimmed
  assert.equal(stripContinuationFence("```js\nmore\n"), "more\n");
  assert.equal(stripContinuationFence("more\n```\n@@END[a1b2c3d4]@@"), "more\n@@END[a1b2c3d4]@@");
  assert.equal(joinContinuation("last line", marker.end(T)), `last line\n${marker.end(T)}`);
  assert.equal(stripPartialMarker("text\n@@EN"), "text\n");
  assert.equal(stripPartialMarker(`text\n${marker.end(T)}`), `text\n${marker.end(T)}`);
});

test("history markers are renormalized to the current token", () => {
  const out = renormalizeMarkers(file("a.js", "js", "x"), "11112222");
  assert.ok(out.includes("@@FILE[11112222]") && out.includes("@@END[11112222]@@"));
  assert.match(newToken(), /^[0-9a-f]{8}$/);
});

test("sensitive and artifact paths are excluded, secrets detected", () => {
  assert.ok(exclusionReason(".env.local"));
  assert.equal(exclusionReason(".env.example"), null);
  assert.ok(exclusionReason("node_modules/x/index.js"));
  assert.equal(exclusionReason(".gitignore"), null);
  assert.ok(findSecret("key=AIzaSyA1234567890123456789012345678901"));
  assert.equal(findSecret("const a = 1"), null);
});
