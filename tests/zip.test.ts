import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildVerifiedZip, planZip, readZipBytes, buildZipBytes } from "../lib/chat/zip.ts";
import { buildPreviewDoc, resolveRef } from "../lib/chat/code-export.ts";

const files = [
  { path: "portfolio/index.html", content: '<!doctype html>\n<p>Halo "dunia" `x` 🚀 é — ```fence```</p>\r\n\t tab\n' },
  { path: "portfolio/css/style.css", content: "body{color:red}\n" },
  { path: "portfolio/js/script.js", content: "console.log('ok');" },
  { path: "other/index.html", content: "B" },
];

test("ZIP is valid, verified, and extracts byte-identical with the unzip tool (scenario 17)", () => {
  const r = buildVerifiedZip(files);
  assert.ok(r.ok);
  if (!r.ok) return;
  const dir = mkdtempSync(path.join(tmpdir(), "zip-"));
  const zipPath = path.join(dir, "t.zip");
  writeFileSync(zipPath, r.bytes);
  assert.match(execFileSync("unzip", ["-t", zipPath]).toString(), /No errors detected/);
  execFileSync("unzip", ["-q", zipPath, "-d", path.join(dir, "out")]);
  for (const f of files) assert.equal(readFileSync(path.join(dir, "out", f.path), "utf8"), f.content);
  assert.match(execFileSync("unzip", ["-Z1", zipPath]).toString(), /portfolio\/css\/style\.css/);
});

test("corrupted archive is detected by the verifier", () => {
  const bytes = buildZipBytes(files);
  bytes[30 + files[0].path.length + 5] ^= 0xff; // flip a byte inside the first file data
  assert.equal(readZipBytes(bytes).ok, false);
  assert.equal(readZipBytes(new Uint8Array(5)).ok, false);
});

test("plan excludes secrets/artifacts and renames case-insensitive collisions", () => {
  const plan = planZip([
    { path: ".env.local", content: "KEY=1" },
    { path: "node_modules/a/b.js", content: "x" },
    { path: ".gitignore", content: "node_modules" },
    { path: "Index.html", content: "1" },
    { path: "index.html", content: "2" },
  ]);
  assert.deepEqual(plan.excluded.map((e) => e.path), [".env.local", "node_modules/a/b.js"]);
  assert.deepEqual(plan.entries.map((e) => e.path), [".gitignore", "Index.html", "index-2.html"]);
  assert.equal(plan.renamed.length, 1);
});

test("empty ZIP is refused", () => assert.equal(buildVerifiedZip([]).ok, false));

test("preview resolves relative paths per folder and does not mix same-named files", () => {
  const set = [
    { name: "site/index.html", content: '<html><head><link rel="stylesheet" href="css/style.css"></head><body><script src="../shared/app.js"></script><a href="about.html">a</a></body></html>' },
    { name: "site/css/style.css", content: "body{background:#fff}" },
    { name: "shared/app.js", content: "window.X='shared'</" + "script>" },
    { name: "other/app.js", content: "window.X='WRONG'" },
  ];
  const doc = buildPreviewDoc(set, "site/index.html");
  assert.ok(doc.includes("body{background:#fff}"));
  assert.ok(doc.includes("window.X='shared'"));
  assert.ok(!doc.includes("WRONG"));
  assert.ok(doc.includes("__aliftzy"));
  assert.ok(!doc.includes('src="../shared/app.js"'));
  assert.equal(resolveRef(set, "site/index.html", "https://cdn.x/a.js"), undefined);
  assert.equal(resolveRef(set, "site/index.html", "missing.js"), undefined);
});
