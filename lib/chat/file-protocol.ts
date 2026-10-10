/**
 * Structured file output protocol, shared by the server (generation control) and the browser (UI).
 *
 * The model writes files between marker lines that carry a per-request random token (nonce):
 *
 *   @@PLAN[a1b2c3d4]|index.html|css/style.css@@
 *   @@FILE[a1b2c3d4]|html|index.html@@
 *   ...raw file content...
 *   @@END[a1b2c3d4]@@
 *   @@DELETE[a1b2c3d4]|old/file.js@@
 *
 * Why not Markdown fences: file content may itself contain ``` (docs, templates, tests), and a fence
 * says nothing about whether a file is finished. A file is complete ONLY if its own END marker (same
 * token) was received. A marker with a different token is ordinary file content.
 *
 * This module is pure (no React, no server-only imports) so it can be unit-tested with plain Node.
 */
import type { FileStatus, GeneratedFile } from "../../types";

const TOKEN = "[0-9a-f]{8}";
const RE_FILE = new RegExp(`^@@FILE\\[(${TOKEN})\\]\\|([^|\\r\\n]{0,24})\\|(.+?)@@$`);
const RE_END = new RegExp(`^@@END\\[(${TOKEN})\\]@@$`);
const RE_PLAN = new RegExp(`^@@PLAN\\[(${TOKEN})\\]\\|(.+?)@@$`);
const RE_DELETE = new RegExp(`^@@DELETE\\[(${TOKEN})\\]\\|(.+?)@@$`);
const RE_MARKER_START = new RegExp(`^@@(?:FILE|END|PLAN|DELETE)\\[${TOKEN}\\]`);
const RE_MARKER_START_G = new RegExp(`^@@(FILE|END|PLAN|DELETE)\\[${TOKEN}\\]`, "gm");

export function newToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export const marker = {
  file: (t: string, lang: string, path: string) => `@@FILE[${t}]|${lang}|${path}@@`,
  end: (t: string) => `@@END[${t}]@@`,
  plan: (t: string, paths: string[]) => `@@PLAN[${t}]|${paths.join("|")}@@`,
  del: (t: string, path: string) => `@@DELETE[${t}]|${path}@@`,
};

/** Rewrites the token of every marker line so old assistant turns stay consistent with this request's token. */
export function renormalizeMarkers(text: string, token: string): string {
  return text.replace(RE_MARKER_START_G, (m) => m.replace(/\[[0-9a-f]{8}\]/, `[${token}]`));
}

/* ---------------- paths, names, languages ---------------- */

/** Relative, harmless, Windows-safe path. Returns "" when nothing usable is left. */
export function normalizePath(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^[`"']+|[`"']+$/g, "")
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:(?=\/)/, "");
  const parts = cleaned
    .split("/")
    .map((p) =>
      p
        .replace(/[<>:"|?*\u0000-\u001f]/g, "")
        .trim()
        .replace(/[. ]+$/g, ""),
    )
    .filter((p) => p && p !== "." && p !== "..");
  return parts.join("/").slice(0, 200);
}

export function baseName(path: string): string {
  return path.split("/").pop() || path;
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A single safe file name for the browser download dialog. */
export function safeFilename(path: string, fallback = "file.txt"): string {
  let n = baseName(normalizePath(path)) || fallback;
  if (WIN_RESERVED.test(n)) n = `_${n}`;
  return n.slice(0, 120);
}

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  htm: "html",
  "c++": "cpp",
  "c#": "csharp",
  rs: "rust",
  rb: "ruby",
  kt: "kotlin",
  txt: "text",
  plaintext: "text",
};

const EXT_LANG: Record<string, string> = {
  html: "html", htm: "html", css: "css", scss: "scss", js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "jsx", ts: "typescript", tsx: "tsx", json: "json", py: "python", sh: "bash", md: "markdown",
  yml: "yaml", yaml: "yaml", xml: "xml", svg: "svg", sql: "sql", java: "java", c: "c", h: "c", cpp: "cpp",
  cs: "csharp", go: "go", rs: "rust", php: "php", rb: "ruby", kt: "kotlin", swift: "swift", dart: "dart",
  txt: "text", toml: "toml", ini: "ini", vue: "vue", svelte: "svelte", env: "bash",
};

const LANG_LABEL: Record<string, string> = {
  html: "HTML", css: "CSS", javascript: "JavaScript", typescript: "TypeScript", jsx: "JSX", tsx: "TSX",
  json: "JSON", python: "Python", bash: "Shell", markdown: "Markdown", yaml: "YAML", xml: "XML", svg: "SVG",
  sql: "SQL", java: "Java", c: "C", cpp: "C++", csharp: "C#", go: "Go", rust: "Rust", php: "PHP",
  ruby: "Ruby", kotlin: "Kotlin", swift: "Swift", dart: "Dart", text: "Text", toml: "TOML", ini: "INI",
  vue: "Vue", svelte: "Svelte", scss: "SCSS",
};

export function extOf(path: string): string {
  const n = baseName(path);
  const i = n.lastIndexOf(".");
  return i > 0 ? n.slice(i + 1).toLowerCase() : n.startsWith(".") ? n.slice(1).toLowerCase() : "";
}

export function languageFor(path: string, hint?: string): string {
  const h = (hint ?? "").trim().toLowerCase();
  if (h) return LANG_ALIASES[h] ?? h.replace(/[^a-z0-9+#-]/g, "") ?? "text";
  return EXT_LANG[extOf(path)] ?? "text";
}

export function languageLabel(language: string): string {
  return LANG_LABEL[language] ?? (language ? language.toUpperCase() : "Text");
}

export function extensionFor(language: string): string {
  const l = (LANG_ALIASES[language.toLowerCase()] ?? language.toLowerCase()).trim();
  const hit = Object.entries(EXT_LANG).find(([, v]) => v === l);
  if (hit) return hit[0] === "htm" ? "html" : hit[0];
  return l.replace(/[^a-z0-9]/g, "") || "txt";
}

function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `f${h.toString(36)}`;
}

export function makeFile(path: string, language: string, content: string, status: FileStatus = "complete"): GeneratedFile {
  const p = normalizePath(path) || `file.${extensionFor(language)}`;
  return {
    id: hashId(p),
    name: baseName(p),
    path: p,
    language: languageFor(p, language),
    content,
    status,
    isComplete: status === "complete",
  };
}

/* ---------------- parser ---------------- */

export type Segment = { kind: "text"; text: string } | { kind: "file"; file: GeneratedFile };

/** A raw block as it appears in the text; positions let the server cut or restart drafts precisely. */
export interface RawBlock {
  path: string;
  start: number; // index of the FILE marker line
  contentStart: number;
  end: number; // index just after the END marker line (or where the broken/open block ended)
  complete: boolean;
}

export interface ParsedResponse {
  segments: Segment[];
  /** Deduplicated by exact path. A complete version always beats an incomplete one. */
  files: GeneratedFile[];
  deleted: string[];
  plan: string[];
  /** The last file if the text ends inside it. */
  openFile: GeneratedFile | null;
  openBlock: RawBlock | null;
  /** Files whose block was cut off by another marker (no END) and have no complete version. */
  brokenFiles: GeneratedFile[];
  /** Planned paths that have no complete file. */
  missingPlanned: string[];
  /** Visible prose: all text outside files and marker lines. */
  prose: string;
  blocks: RawBlock[];
}

/** A trailing line without newline that could still grow into a marker: hidden while streaming. */
function isPendingMarker(line: string): boolean {
  if (!line.startsWith("@@") || line.length > 300) return false;
  if (RE_FILE.test(line) || RE_END.test(line) || RE_PLAN.test(line) || RE_DELETE.test(line)) return false;
  return /^@@(?:F(?:I(?:L(?:E)?)?)?|E(?:N(?:D)?)?|P(?:L(?:A(?:N)?)?)?|D(?:E(?:L(?:E(?:T(?:E)?)?)?)?)?)?(?:\[[0-9a-f]{0,8}\]?(?:\|.*)?)?$/.test(line);
}

interface Cur {
  token: string;
  lang: string;
  path: string;
  start: number;
  contentStart: number;
}

interface RawFile {
  path: string;
  lang: string;
  content: string;
  block: RawBlock;
}

export function parseResponse(content: string, opts: { final: boolean }): ParsedResponse {
  const raw: RawFile[] = [];
  const blocks: RawBlock[] = [];
  const deleted: string[] = [];
  const plan: string[] = [];
  let cur: Cur | null = null;

  const closeBlock = (contentEnd: number, blockEnd: number, complete: boolean) => {
    if (!cur) return;
    const block: RawBlock = { path: cur.path, start: cur.start, contentStart: cur.contentStart, end: blockEnd, complete };
    blocks.push(block);
    raw.push({ path: cur.path, lang: cur.lang, content: content.slice(cur.contentStart, contentEnd), block });
    cur = null;
  };

  const len = content.length;
  let pos = 0;
  let stoppedAt = len; // where scanning stopped (a hidden pending marker)
  while (pos < len) {
    const nl = content.indexOf("\n", pos);
    const next = nl === -1 ? len : nl + 1;
    const line = content.slice(pos, nl === -1 ? len : nl).replace(/\r$/, "");

    if (nl === -1 && !opts.final && isPendingMarker(line)) {
      stoppedAt = pos;
      break;
    }

    const mFile = RE_FILE.exec(line);
    const mEnd = mFile ? null : RE_END.exec(line);
    const mPlan = mFile || mEnd ? null : RE_PLAN.exec(line);
    const mDel = mFile || mEnd || mPlan ? null : RE_DELETE.exec(line);

    if (cur) {
      const token: string = cur.token;
      if (mEnd && mEnd[1] === token) {
        closeBlock(pos, next, true);
        pos = next;
        continue;
      }
      const interrupts = (mFile && mFile[1] === token) || (mPlan && mPlan[1] === token) || (mDel && mDel[1] === token);
      if (!interrupts) {
        pos = next; // ordinary file content (markers with another token included)
        continue;
      }
      closeBlock(pos, pos, false); // previous file never got its END marker; fall through to handle this marker
    }

    if (mFile) {
      const path = normalizePath(mFile[3]) || `file-${raw.length + 1}.${extensionFor(mFile[2])}`;
      cur = { token: mFile[1], lang: mFile[2], path, start: pos, contentStart: next };
    } else if (mPlan) {
      for (const p of mPlan[2].split("|")) {
        const np = normalizePath(p);
        if (np && !plan.includes(np)) plan.push(np);
      }
    } else if (mDel) {
      const np = normalizePath(mDel[2]);
      if (np && !deleted.includes(np)) deleted.push(np);
    }
    pos = next;
  }

  let openBlock: RawBlock | null = null;
  if (cur) {
    const c: Cur = cur;
    openBlock = { path: c.path, start: c.start, contentStart: c.contentStart, end: len, complete: false };
    blocks.push(openBlock);
    raw.push({ path: c.path, lang: c.lang, content: content.slice(c.contentStart, stoppedAt), block: openBlock });
  }

  // Dedupe by exact path: a complete version beats an incomplete one; a later complete beats an earlier one.
  const byPath = new Map<string, number>();
  const files: GeneratedFile[] = [];
  for (const r of raw) {
    const status: FileStatus = r.block.complete ? "complete" : r.block === openBlock ? (opts.final ? "incomplete" : "writing") : "incomplete";
    const file = makeFile(r.path, r.lang, r.content, status);
    const at = byPath.get(r.path);
    if (at === undefined) {
      byPath.set(r.path, files.length);
      files.push(file);
    } else if (r.block.complete || !files[at].isComplete) {
      files[at] = file;
    }
  }

  // Segments in textual order; each file appears once, at its first block.
  const segments: Segment[] = [];
  const placed = new Set<string>();
  let cursor = 0;
  const pushText = (from: number, to: number) => {
    if (to <= from) return;
    const t = stripMarkerLines(content.slice(from, Math.min(to, stoppedAt)), opts.final);
    if (t.trim()) segments.push({ kind: "text", text: t });
  };
  for (const b of [...blocks].sort((x, y) => x.start - y.start)) {
    pushText(cursor, b.start);
    if (!placed.has(b.path)) {
      placed.add(b.path);
      segments.push({ kind: "file", file: files[byPath.get(b.path) as number] });
    }
    cursor = Math.max(cursor, b.end);
  }
  pushText(cursor, len);

  const prose = segments
    .map((s) => (s.kind === "text" ? s.text : ""))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const openFile = openBlock ? files[byPath.get(openBlock.path) as number] : null;
  const stillOpen = openFile && !openFile.isComplete ? openFile : null;
  const brokenFiles = files.filter((f) => f.status === "incomplete" && f !== stillOpen);
  const missingPlanned = plan.filter((p) => !files.some((f) => f.path === p && f.isComplete));

  return { segments, files, deleted, plan, openFile: stillOpen, openBlock: stillOpen ? openBlock : null, brokenFiles, missingPlanned, prose, blocks };
}

/** Removes PLAN/DELETE/END marker lines (and a dangling partial marker) from prose. */
function stripMarkerLines(text: string, final: boolean): string {
  const lines = text.split("\n");
  const out: string[] = [];
  lines.forEach((l, i) => {
    const t = l.replace(/\r$/, "");
    if (RE_PLAN.test(t) || RE_DELETE.test(t) || RE_END.test(t)) return;
    if (!final && i === lines.length - 1 && isPendingMarker(t)) return;
    out.push(l);
  });
  return out.join("\n");
}

/** Cuts a dangling, unfinished marker fragment such as "@@EN" from the end of text. */
export function stripPartialMarker(text: string): string {
  const i = text.lastIndexOf("\n") + 1;
  const last = text.slice(i);
  if (!last.startsWith("@@")) return text;
  const full = RE_FILE.test(last) || RE_END.test(last) || RE_PLAN.test(last) || RE_DELETE.test(last);
  return full ? text : text.slice(0, i);
}

/** Removes drafts that were superseded by a complete file with the same path. */
export function compactResponse(content: string): string {
  const parsed = parseResponse(content, { final: true });
  const drop = parsed.blocks.filter((b) => !b.complete && parsed.files.some((f) => f.path === b.path && f.isComplete));
  if (drop.length === 0) return content;
  let out = "";
  let cursor = 0;
  for (const b of [...drop].sort((a, c) => a.start - c.start)) {
    out += content.slice(cursor, b.start);
    cursor = b.end;
  }
  return out + content.slice(cursor);
}

/* ---------------- continuation helpers ---------------- */

/** Longest suffix of `existing` that `next` repeats at its start (>= minLen chars): the repeated part is cut. */
export function trimOverlap(existing: string, next: string, maxWindow = 3000, minLen = 24): string {
  const max = Math.min(maxWindow, existing.length, next.length);
  for (let k = max; k >= minLen; k -= 1) {
    if (existing.endsWith(next.slice(0, k))) return next.slice(k);
  }
  return next;
}

/** A model continuing "inside" a file must not wrap it in a fence; remove one if it did. */
export function stripContinuationFence(next: string): string {
  return next.replace(/^[ \t]*```[\w+#-]*[ \t]*\r?\n/, "").replace(/\r?\n[ \t]*```[ \t]*\r?\n(?=@@END\[)/, "\n");
}

/** Glue continuation text on, making sure a marker lands at the start of a line. */
export function joinContinuation(existing: string, next: string): string {
  if (existing && !existing.endsWith("\n") && RE_MARKER_START.test(next)) return `${existing}\n${next}`;
  return existing + next;
}

export function startsWithFileMarker(text: string): { path: string } | null {
  const first = text.replace(/^\s+/, "").split("\n", 1)[0].replace(/\r$/, "");
  const m = RE_FILE.exec(first);
  return m ? { path: normalizePath(m[3]) } : null;
}

/** True when ``` fences outside of protocol files are unbalanced (legacy fenced answers cut off mid-block). */
export function hasUnclosedFence(prose: string): boolean {
  return ((prose.match(/^```/gm) ?? []).length & 1) === 1;
}

/* ---------------- paths that must never be exported ---------------- */

const EXCLUDED_DIRS = /(^|\/)(node_modules|\.next|\.git|\.vercel|dist|build|coverage|\.cache|__pycache__)(\/|$)/;

/** Returns a human reason when a path must not go into an archive, otherwise null. */
export function exclusionReason(path: string): string | null {
  const p = path.toLowerCase();
  const n = baseName(p);
  if (/^\.env(\..+)?$/.test(n) && !/\.(example|sample|template)$/.test(n)) return "environment file (may contain secrets)";
  if (/\.(pem|key|p12|pfx)$/.test(n) || /^id_(rsa|ed25519|ecdsa)$/.test(n)) return "private key / certificate";
  if (EXCLUDED_DIRS.test(p)) return "dependency, cache or build artifact";
  if (n === ".ds_store" || n === "thumbs.db") return "system file";
  return null;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/AIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/\bsk-[A-Za-z0-9_-]{20,}/, "API secret key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
];

export function findSecret(content: string): string | null {
  for (const [re, label] of SECRET_PATTERNS) if (re.test(content)) return label;
  return null;
}
