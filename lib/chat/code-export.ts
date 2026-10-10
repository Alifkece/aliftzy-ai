/** Extract files from fenced code blocks and download them (single file or ZIP). No dependencies. */

export interface ExportFile {
  name: string;
  content: string;
}

const EXT: Record<string, string> = {
  html: "html",
  css: "css",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  json: "json",
  python: "py",
  py: "py",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  markdown: "md",
  md: "md",
  yaml: "yml",
  yml: "yml",
  xml: "xml",
  svg: "svg",
  sql: "sql",
  java: "java",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  go: "go",
  rust: "rs",
  php: "php",
  ruby: "rb",
  kotlin: "kt",
  swift: "swift",
  dart: "dart",
  text: "txt",
};

export function extensionFor(language: string): string {
  return EXT[language.toLowerCase()] ?? (language ? language.toLowerCase().replace(/[^a-z0-9]/g, "") || "txt" : "txt");
}

/** Keep paths relative and harmless. */
export function sanitizePath(name: string): string {
  const parts = name
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.replace(/[<>:"|?*\u0000-\u001f]/g, "").trim())
    .filter((p) => p && p !== "." && p !== "..");
  return parts.join("/").slice(0, 120);
}

/** Read a file name from the fence info string: title="index.html", or a bare token that looks like a file. */
export function nameFromMeta(meta: string | undefined | null): string {
  if (!meta) return "";
  const titled = /(?:title|file|filename|name)\s*=\s*["']?([^"'\s]+)["']?/i.exec(meta);
  if (titled) return sanitizePath(titled[1]);
  const bare = meta.split(/\s+/).find((t) => /^[\w./-]+\.[A-Za-z0-9]{1,8}$/.test(t));
  return bare ? sanitizePath(bare) : "";
}

const FENCE = /^```([\w+#-]*)[^\S\n]*([^\n]*)\n([\s\S]*?)\n```[ \t]*$/gm;

/** Complete fenced blocks of a Markdown answer, as files. Unnamed blocks get a default name. */
export function extractFiles(markdown: string): ExportFile[] {
  const files: ExportFile[] = [];
  const used = new Set<string>();
  let n = 0;
  for (const m of markdown.matchAll(FENCE)) {
    const language = m[1] ?? "";
    const content = m[3] ?? "";
    if (!content.trim()) continue;
    n += 1;
    let name = nameFromMeta(m[2]);
    if (!name) name = language === "html" && n === 1 ? "index.html" : `file-${n}.${extensionFor(language)}`;
    let unique = name;
    for (let i = 2; used.has(unique); i += 1) {
      const dot = name.lastIndexOf(".");
      unique = dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`;
    }
    used.add(unique);
    files.push({ name: unique, content });
  }
  return files;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(filename: string, text: string) {
  const base = filename.split("/").pop() || "file.txt";
  saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), base);
}

/* ---- Minimal ZIP writer (store, no compression) ---- */

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZip(files: ExportFile[]): Blob {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // store
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, dosTime, true);
    entry.setUint16(14, dosDate, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    const bytes = new Uint8Array(46 + name.length);
    bytes.set(new Uint8Array(entry.buffer), 0);
    bytes.set(name, 46);
    central.push(bytes);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central.map((c) => c.buffer as ArrayBuffer), end.buffer], { type: "application/zip" });
}

export function downloadZip(files: ExportFile[], zipName = "aliftzy-files.zip") {
  saveBlob(buildZip(files), zipName);
}

/* ---- Preview helpers ---- */

export function isHtmlFile(name: string): boolean {
  return /\.html?$/i.test(name);
}

function findFile(files: ExportFile[], ref: string): ExportFile | undefined {
  const clean = ref.split(/[?#]/)[0].replace(/^\.?\//, "");
  if (!clean || /^(https?:)?\/\//i.test(clean)) return undefined;
  const base = clean.split("/").pop();
  return files.find((f) => f.name === clean) ?? files.find((f) => f.name.split("/").pop() === base);
}

/** Inline local CSS and JS files into the HTML so a multi-file site works inside one sandboxed iframe. */
export function bundleHtml(files: ExportFile[], entry: ExportFile): string {
  return entry.content
    .replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/rel=["']?stylesheet/i.test(tag)) return tag;
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      const file = href ? findFile(files, href) : undefined;
      return file ? `<style>\n${file.content}\n</style>` : tag;
    })
    .replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a: string, src: string, b: string) => {
      const file = findFile(files, src);
      return file ? `<script${a}${b}>\n${file.content.replace(/<\/script/gi, "<\\/script")}\n</script>` : tag;
    });
}
