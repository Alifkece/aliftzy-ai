/**
 * Browser helpers for generated files: copy, download, ZIP download, and the sandboxed preview document.
 * File detection itself lives in ./file-protocol (structured markers), not in Markdown fences.
 */
import { baseName, extOf, normalizePath, safeFilename } from "./file-protocol";

export { extensionFor } from "./file-protocol";

export interface ExportFile {
  /** Relative path inside the project. */
  name: string;
  content: string;
}

/** Fence info string -> file name, for snippets in normal answers (title="index.html" or a bare file-like token). */
export function nameFromMeta(meta: string | undefined | null): string {
  if (!meta) return "";
  const titled = /(?:title|file|filename|name)\s*=\s*["']?([^"'\s]+)["']?/i.exec(meta);
  if (titled) return normalizePath(titled[1]);
  const bare = meta.split(/\s+/).find((t) => /^[\w./-]+\.[A-Za-z0-9]{1,8}$/.test(t));
  return bare ? normalizePath(bare) : "";
}

/* ---------------- copy ---------------- */

/** Copies raw text (never highlighted markup). Resolves true only if the copy really happened. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/* ---------------- download ---------------- */

const MIME: Record<string, string> = {
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", json: "application/json",
  svg: "image/svg+xml", md: "text/markdown", xml: "application/xml", csv: "text/csv",
};

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Saves exactly the file content (UTF-8, no BOM, line breaks untouched) under a safe file name. */
export function downloadFile(path: string, content: string) {
  const mime = MIME[extOf(path)] ?? "text/plain";
  saveBlob(new Blob([content], { type: `${mime};charset=utf-8` }), safeFilename(path));
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = "application/zip") {
  const copy = new Uint8Array(bytes); // detach from any shared buffer
  saveBlob(new Blob([copy], { type: mime }), safeFilename(filename, "archive.zip"));
}

/* ---------------- preview ---------------- */

export function isHtmlFile(name: string): boolean {
  return /\.html?$/i.test(name);
}

export function isPreviewable(name: string): boolean {
  return isHtmlFile(name) || /\.svg$/i.test(name);
}

/** Why a file has no live preview (honest, specific). */
export function previewUnavailableReason(name: string): string {
  const ext = extOf(name);
  if (ext === "md" || ext === "txt" || ext === "json") return "This file type is not rendered as a page. Use the Code tab.";
  if (["py", "java", "go", "rs", "php", "rb", "sh", "ts", "tsx", "jsx", "vue", "svelte", "cs", "kt", "swift", "dart", "sql"].includes(ext)) {
    return "Source files like this need a runtime or a build step that the browser preview does not have. Run it locally.";
  }
  if (ext === "css" || ext === "js") return "Open an HTML file that uses this file to see it running.";
  return "Preview is only available for HTML and SVG files.";
}

/** Resolves a reference found in `fromPath` to a project file path, or undefined (remote, data:, hash, missing). */
export function resolveRef(files: ExportFile[], fromPath: string, ref: string): ExportFile | undefined {
  const clean = ref.trim().split(/[?#]/)[0];
  if (!clean || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(clean)) return undefined;
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    /* keep raw */
  }
  const dir = decoded.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  const out: string[] = [...dir];
  for (const seg of decoded.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  const target = out.join("/");
  const exact = files.find((f) => f.name === target) ?? files.find((f) => f.name.toLowerCase() === target.toLowerCase());
  if (exact) return exact;
  const same = files.filter((f) => baseName(f.name) === baseName(target));
  return same.length === 1 ? same[0] : undefined;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const BRIDGE = `<script>(function(){var P=window.parent;function post(m){try{P.postMessage(m,"*")}catch(e){}}
window.addEventListener("error",function(e){post({__aliftzy:"error",message:String(e.message||"Script error")})});
window.addEventListener("unhandledrejection",function(e){post({__aliftzy:"error",message:"Unhandled promise rejection: "+String(e.reason)})});
document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href")||"";if(!h||h.charAt(0)==="#")return;
if(/^(https?:|\\/\\/)/i.test(h)){e.preventDefault();post({__aliftzy:"external",href:h});return}
if(/^(mailto:|tel:|javascript:|data:)/i.test(h))return;
e.preventDefault();post({__aliftzy:"navigate",href:h})},true);})();</script>`;

/**
 * Builds ONE self-contained document for the sandboxed iframe: local CSS/JS (and SVG images) are inlined,
 * references are resolved relative to the HTML file's own folder, and a tiny bridge reports script errors and
 * local page navigation to the parent. Remote URLs are left untouched.
 */
export function buildPreviewDoc(files: ExportFile[], entryPath: string): string {
  const entry = files.find((f) => f.name === entryPath);
  if (!entry) return "";
  if (/\.svg$/i.test(entryPath)) {
    return `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${entry.content}${BRIDGE}</body>`;
  }
  const inlineCssUrls = (css: string, cssPath: string) =>
    css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, _q: string, ref: string) => {
      const f = resolveRef(files, cssPath, ref);
      return f && /\.svg$/i.test(f.name) ? `url("${svgDataUri(f.content)}")` : m;
    });

  let html = entry.content
    .replace(/<link\b[^>]*>/gi, (tag) => {
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href) return tag;
      const file = resolveRef(files, entryPath, href);
      if (!file) return tag;
      if (/rel=["']?stylesheet/i.test(tag)) return `<style>\n${inlineCssUrls(file.content, file.name)}\n</style>`;
      if (/rel=["']?(shortcut )?icon/i.test(tag) && /\.svg$/i.test(file.name)) return tag.replace(href, svgDataUri(file.content));
      return tag;
    })
    .replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a: string, src: string, b: string) => {
      const file = resolveRef(files, entryPath, src);
      return file ? `<script${a}${b}>\n${file.content.replace(/<\/script/gi, "<\\/script")}\n</script>` : tag;
    })
    .replace(/<(img|source)\b[^>]*>/gi, (tag) => {
      const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
      const file = src ? resolveRef(files, entryPath, src) : undefined;
      return file && /\.svg$/i.test(file.name) && src ? tag.replace(src, svgDataUri(file.content)) : tag;
    })
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (block) => inlineCssUrls(block, entryPath));

  html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (m) => `${m}${BRIDGE}`) : `${BRIDGE}${html}`;
  return html;
}
