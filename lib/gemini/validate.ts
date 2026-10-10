import "server-only";
import type { ChatAttachmentPayload, ChatMessagePayload, ChatRequest } from "@/types";
import { ERRORS, LIMITS, classifyFile, isPdf, limitFor } from "@/lib/files/rules";

export class ValidationError extends Error {}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Returns a Gemini-supported video MIME type from the file signature, or null. */
function sniffVideo(buf: Buffer): string | null {
  // WebM / Matroska: EBML header
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  // MP4 / MOV: "ftyp" box at offset 4; the brand tells QuickTime apart.
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    return brand === "qt  " ? "video/mov" : "video/mp4";
  }
  return null;
}

function validateAttachment(raw: unknown): ChatAttachmentPayload {
  if (!isRecord(raw)) throw new ValidationError(ERRORS.failed);
  const name = typeof raw.name === "string" ? raw.name.slice(0, 200) : "";
  const mime = typeof raw.mime === "string" ? raw.mime : "";
  if (!name) throw new ValidationError(ERRORS.failed);

  const kind = classifyFile(name, mime);
  if (!kind || kind !== raw.kind) throw new ValidationError(ERRORS.unsupported);

  const pdf = isPdf(name, mime);
  const binary = kind === "image" || kind === "video" || pdf;

  if (binary) {
    if (typeof raw.data !== "string" || raw.data.length === 0) throw new ValidationError(ERRORS.empty);
    if (!BASE64_RE.test(raw.data)) throw new ValidationError(ERRORS.failed);
    const buf = Buffer.from(raw.data, "base64");
    if (buf.length === 0) throw new ValidationError(ERRORS.empty);
    if (buf.length > limitFor(kind, pdf)) throw new ValidationError(ERRORS.tooLarge);

    // Trust the bytes, not the declared MIME type.
    if (kind === "image") {
      const sniffed = sniffImage(buf);
      if (!sniffed) throw new ValidationError(ERRORS.failed);
      return { name, kind, mime: sniffed, size: buf.length, data: raw.data };
    }
    if (kind === "video") {
      const sniffed = sniffVideo(buf);
      if (!sniffed) throw new ValidationError(ERRORS.failed);
      return { name, kind, mime: sniffed, size: buf.length, data: raw.data };
    }
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ValidationError(ERRORS.failed);
    return { name, kind, mime: "application/pdf", size: buf.length, data: raw.data };
  }

  // Text-like document
  if (typeof raw.text !== "string") throw new ValidationError(ERRORS.failed);
  if (raw.text.trim().length === 0) throw new ValidationError(ERRORS.empty);
  if (Buffer.byteLength(raw.text, "utf8") > limitFor("document", false)) throw new ValidationError(ERRORS.tooLarge);
  if (raw.text.includes("\u0000")) throw new ValidationError(ERRORS.failed);
  return { name, kind, mime: "text/plain", size: Buffer.byteLength(raw.text, "utf8"), text: raw.text };
}

function validateMessage(raw: unknown): ChatMessagePayload {
  if (!isRecord(raw)) throw new ValidationError("Invalid message.");
  const { role, content } = raw;
  if (role !== "user" && role !== "assistant") throw new ValidationError("Invalid message role.");
  if (typeof content !== "string") throw new ValidationError("Invalid message content.");
  if (content.length > (role === "assistant" ? LIMITS.maxAssistantChars : LIMITS.maxTextChars)) throw new ValidationError("Message is too long.");

  let attachments: ChatAttachmentPayload[] | undefined;
  if (raw.attachments !== undefined) {
    if (role !== "user" || !Array.isArray(raw.attachments)) throw new ValidationError("Invalid attachments.");
    if (raw.attachments.length > LIMITS.maxAttachmentsPerMessage) throw new ValidationError(ERRORS.tooMany);
    attachments = raw.attachments.map(validateAttachment);
  }
  return { role, content, attachments };
}

export function validateChatRequest(body: unknown): ChatRequest {
  if (!isRecord(body) || !Array.isArray(body.messages)) throw new ValidationError("Invalid request.");
  if (body.messages.length === 0) throw new ValidationError("No messages to send.");
  if (body.messages.length > LIMITS.maxMessages) throw new ValidationError("Conversation is too long.");

  const messages = body.messages.map(validateMessage);
  const last = messages[messages.length - 1];
  if (last.role !== "user") throw new ValidationError("The last message must be from the user.");
  if (last.content.trim().length === 0 && (last.attachments?.length ?? 0) === 0) throw new ValidationError("No messages to send.");

  // Drop empty assistant turns (e.g. a stopped generation with no text).
  const cleaned = messages.filter((m) => m.role === "user" || m.content.trim().length > 0);
  if (cleaned[0]?.role !== "user") throw new ValidationError("The conversation must start with a user message.");
  return { messages: cleaned };
}
