export type Role = "user" | "assistant";

export type AttachmentKind = "image" | "document" | "video";
export type AttachmentStatus = "uploading" | "ready" | "processing" | "error" | "removed";

/** Attachment as held in browser memory (may include binary data). */
export interface Attachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  /** Object URL for thumbnail / video preview (never persisted). */
  preview?: string;
  /** base64 payload without data: prefix (never persisted). */
  data?: string;
  /** Plain text content for text-like documents (never persisted). */
  text?: string;
  status: AttachmentStatus;
  error?: string;
}

/** Attachment metadata persisted with a message (no binary). */
export interface StoredAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  attachments?: StoredAttachment[];
  /** Set when generation was interrupted by the user. */
  stopped?: boolean;
  /** Set when the request failed. */
  error?: string;
  /** Transient status line while the server continues a long generation automatically. Never persisted meaningfully. */
  progress?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export type ThemeSetting = "dark" | "light" | "system";

export interface AppSettings {
  theme: ThemeSetting;
}

/** Wire format: attachment payload sent to /api/chat. */
export interface ChatAttachmentPayload {
  name: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  data?: string;
  text?: string;
}

export interface ChatMessagePayload {
  role: Role;
  content: string;
  attachments?: ChatAttachmentPayload[];
}

export interface ChatRequest {
  messages: ChatMessagePayload[];
}

/**
 * Wire format of /api/chat (newline-delimited JSON).
 *  - text:     append to the answer
 *  - replace:  authoritative full answer so far (used when the server drops a superseded draft)
 *  - progress: informational status, e.g. automatic continuation of a long answer
 *  - done:     the answer is complete AND validated (no open file, every planned file present)
 *  - error:    generation failed; everything received before the error is kept as a draft
 * A stream that ends without "done" or "error" is treated by the client as an interrupted connection.
 */
export type StreamingEvent =
  | { type: "text"; text: string }
  | { type: "replace"; text: string }
  | { type: "progress"; message: string }
  | { type: "done"; stopReason: string | null; rounds: number }
  | { type: "error"; message: string };

/* ---- Structured file output (see lib/chat/file-protocol.ts) ---- */

/** writing: still streaming. complete: closed by its end marker. incomplete: generation ended before the end marker. */
export type FileStatus = "writing" | "complete" | "incomplete";

export interface GeneratedFile {
  /** Stable id derived from the normalized path. */
  id: string;
  /** File name without folders, e.g. "style.css". */
  name: string;
  /** Normalized relative path inside the project, e.g. "css/style.css". */
  path: string;
  /** Normalized language id, e.g. "html", "javascript". */
  language: string;
  /** Raw source code exactly as written by the model (no fences, no explanations). */
  content: string;
  status: FileStatus;
  /** True only when the file was closed by its end marker. Only complete files can be downloaded or zipped. */
  isComplete: boolean;
}

/** How a generated file relates to what the project already contained. */
export type FileChange = "new" | "modified" | "unchanged";

export interface ModelInfo {
  label: string;
}
