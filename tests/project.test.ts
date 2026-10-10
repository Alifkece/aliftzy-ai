import test from "node:test";
import assert from "node:assert/strict";
import { analyzeConversation, changedFiles } from "../lib/chat/project.ts";
import { marker } from "../lib/chat/file-protocol.ts";
import { buildVerifiedZip, planZip } from "../lib/chat/zip.ts";
import { detectIntent } from "../lib/chat/intent.ts";
import type { Message } from "../types/index.ts";

const T = "a1b2c3d4";
const f = (p: string, body: string) => `${marker.file(T, "html", p)}\n${body}\n${marker.end(T)}\n`;
const msg = (id: string, role: "user" | "assistant", content: string): Message => ({ id, role, content, createdAt: 0 });

test("changed-only: unchanged file is not reported or zipped; new + modified are; deletions listed", () => {
  const msgs = [
    msg("u1", "user", "buat website"),
    msg("a1", "assistant", f("index.html", "<h1>Hi</h1>") + f("css/style.css", "a{}") + f("js/app.js", "1")),
    msg("u2", "user", "ubah judul saja, kirim hanya file yang berubah"),
    msg("a2", "assistant", f("index.html", "<h1>Hello</h1>") + f("css/style.css", "a{}\n") + f("js/new.js", "2") + marker.del(T, "js/app.js") + "\n"),
  ];
  const a = analyzeConversation(msgs, null, () => undefined);
  const second = a.get("a2")!;
  assert.deepEqual(second.changes, { "index.html": "modified", "css/style.css": "unchanged", "js/new.js": "new" });
  assert.deepEqual(second.deleted, ["js/app.js"]);
  const changed = changedFiles(second.parsed.files, second.changes);
  assert.deepEqual(changed.map((x) => x.path), ["index.html", "js/new.js"]);
  const zip = buildVerifiedZip(planZip(changed.map((x) => ({ path: x.path, content: x.content }))).entries);
  assert.ok(zip.ok);
  assert.equal(a.get("a1")!.changes["index.html"], "new");
});

test("user-attached file is the baseline: identical content is 'unchanged'", () => {
  const msgs = [msg("u1", "user", "edit"), msg("a1", "assistant", f("index.html", "same") + f("page.html", "x"))];
  const a = analyzeConversation(msgs, null, () => [{ name: "index.html", text: "same\r\n" }]);
  assert.equal(a.get("a1")!.changes["index.html"], "unchanged");
  assert.equal(a.get("a1")!.changes["page.html"], "new");
});

test("incomplete files never enter the baseline or changed list", () => {
  const msgs = [msg("a1", "assistant", `${marker.file(T, "js", "a.js")}\npartial`)];
  const a = analyzeConversation(msgs, null, () => undefined).get("a1")!;
  assert.equal(changedFiles(a.parsed.files, a.changes).length, 0);
});

test("intent detection (id + en)", () => {
  assert.deepEqual(detectIntent("Buat project lengkap lalu kirim dalam ZIP"), { zip: true, changedOnly: false });
  assert.equal(detectIntent("ubah navbar, kirim hanya file yang berubah").changedOnly, true);
  assert.equal(detectIntent("send only the files that changed as a zip").changedOnly, true);
  assert.equal(detectIntent("Perbaiki CSS yang berubah-ubah").changedOnly, false);
  assert.deepEqual(detectIntent("jelaskan apa itu closure"), { zip: false, changedOnly: false });
});
