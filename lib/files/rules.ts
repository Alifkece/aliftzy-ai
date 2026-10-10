import type { AttachmentKind } from "@/types";

/**
 * Single source of truth for upload rules, shared by client (UX) and server (enforcement).
 * Gemini accepts inline JPEG/PNG/WebP images, PDFs and short videos; text-like files are inlined as text.
 * Inline data counts toward the request size, and Vercel caps request bodies at ~4.5 MB, hence the small limits.
 */
export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PDF_MIME = "application/pdf";
export const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime"] as const;

export const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "toml", "ini", "log",
  "html", "css", "js", "jsx", "ts", "tsx", "py", "java", "kt", "go", "rs", "rb", "php", "c",
  "h", "cpp", "hpp", "cs", "swift", "sh", "sql", "vue", "svelte",
] as const;

export const LIMITS = {
  /** Raw bytes. Vercel serverless request bodies are capped at ~4.5 MB (base64 adds ~33%), so limits are conservative. */
  imageBytes: 3 * 1024 * 1024,
  pdfBytes: 3 * 1024 * 1024,
  textBytes: 1 * 1024 * 1024,
  videoBytes: 3 * 1024 * 1024,
  maxAttachmentsPerMessage: 5,
  /** Total request body guard (server); see README for the Vercel body limit. */
  maxRequestBytes: 4.4 * 1024 * 1024,
  /** Client-side guard for the sum of base64 payloads in one send. */
  maxPayloadChars: 4.2 * 1024 * 1024,
  maxMessages: 100,
  maxTextChars: 200_000,
} as const;

export const ERRORS = {
  unsupported: "Unsupported file type.",
  tooLarge: "File is too large.",
  empty: "This file is empty.",
  failed: "Unable to process this file.",
  tooMany: `You can attach up to ${LIMITS.maxAttachmentsPerMessage} files per message.`,
} as const;

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

export function classifyFile(name: string, mime: string): AttachmentKind | null {
  if ((IMAGE_MIMES as readonly string[]).includes(mime)) return "image";
  if (mime === PDF_MIME) return "document";
  if ((VIDEO_MIMES as readonly string[]).includes(mime)) return "video";
  const ext = extensionOf(name);
  if ((TEXT_EXTENSIONS as readonly string[]).includes(ext)) return "document";
  if (ext === "pdf") return "document";
  if (ext === "mp4" || ext === "webm" || ext === "mov") return "video";
  return null;
}

export function isPdf(name: string, mime: string): boolean {
  return mime === PDF_MIME || extensionOf(name) === "pdf";
}

export function limitFor(kind: AttachmentKind, pdf: boolean): number {
  if (kind === "image") return LIMITS.imageBytes;
  if (kind === "video") return LIMITS.videoBytes;
  return pdf ? LIMITS.pdfBytes : LIMITS.textBytes;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
