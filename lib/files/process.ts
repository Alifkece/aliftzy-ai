import type { Attachment } from "@/types";
import { ERRORS, LIMITS, classifyFile, isPdf, limitFor } from "./rules";
import { uid } from "@/lib/utils/id";

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(ERRORS.failed));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error(ERRORS.failed));
      const comma = result.indexOf(",");
      resolve(comma === -1 ? "" : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function canDecodeImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

function failed(file: File, message: string): Attachment {
  return { id: uid(), name: file.name, kind: classifyFile(file.name, file.type) ?? "document", mime: file.type, size: file.size, status: "error", error: message };
}

/** File -> Attachment (client side). Errors are returned as `status: "error"`, never thrown. */
export async function processFile(file: File): Promise<Attachment> {
  const kind = classifyFile(file.name, file.type);
  if (!kind) return failed(file, ERRORS.unsupported);
  if (file.size === 0) return failed(file, ERRORS.empty);
  const pdf = isPdf(file.name, file.type);
  if (file.size > limitFor(kind, pdf)) return failed(file, ERRORS.tooLarge);

  const base: Attachment = { id: uid(), name: file.name, kind, mime: file.type, size: file.size, status: "processing" };

  try {
    if (kind === "image") {
      const preview = URL.createObjectURL(file);
      if (!(await canDecodeImage(preview))) {
        URL.revokeObjectURL(preview);
        return failed(file, ERRORS.failed);
      }
      return { ...base, preview, data: await readAsBase64(file), status: "ready" };
    }

    if (kind === "video") {
      // Gemini reads short videos inline as base64 (size-limited by rules.ts).
      return { ...base, mime: file.type || "video/mp4", preview: URL.createObjectURL(file), data: await readAsBase64(file), status: "ready" };
    }

    if (pdf) {
      const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (String.fromCharCode(...head) !== "%PDF-") return failed(file, ERRORS.failed);
      return { ...base, mime: "application/pdf", data: await readAsBase64(file), status: "ready" };
    }

    const text = await file.text();
    if (text.trim().length === 0) return failed(file, ERRORS.empty);
    if (text.includes("\u0000")) return failed(file, ERRORS.failed);
    if (text.length > LIMITS.maxTextChars) return failed(file, ERRORS.tooLarge);
    return { ...base, mime: "text/plain", text, status: "ready" };
  } catch {
    return failed(file, ERRORS.failed);
  }
}

export function revokePreview(att: Attachment): void {
  if (att.preview) URL.revokeObjectURL(att.preview);
}

/** Approximate request weight of an attachment in characters. */
export function payloadWeight(att: Attachment): number {
  return (att.data?.length ?? 0) + (att.text?.length ?? 0);
}
