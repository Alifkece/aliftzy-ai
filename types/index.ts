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
  /** Set when the answer was cut off (token limit or dropped connection); the user can Continue. */
  truncated?: boolean;
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

export type StreamingEvent =
  | { type: "text"; text: string }
  | { type: "done"; stopReason: string | null }
  | { type: "error"; message: string };

export interface ModelInfo {
  label: string;
}
