import "server-only";
import type { ChatAttachmentPayload, ChatMessagePayload } from "@/types";

/**
 * Gemini Interactions API content parts and steps (documented shapes):
 *  - text:     { type: "text", text }
 *  - image:    { type: "image", data: <base64>, mime_type }
 *  - document: { type: "document", data: <base64>, mime_type: "application/pdf" }
 *  - video:    { type: "video", data: <base64>, mime_type }
 *  - steps:    { type: "user_input" | "model_output", content: Part[] }
 */
export type Part =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mime_type: string }
  | { type: "document"; data: string; mime_type: string }
  | { type: "video"; data: string; mime_type: string };

export interface Step {
  type: "user_input" | "model_output";
  content: Part[];
}

function attachmentToParts(att: ChatAttachmentPayload): Part[] {
  if (att.kind === "image" && att.data) return [{ type: "image", data: att.data, mime_type: att.mime }];
  if (att.kind === "video" && att.data) return [{ type: "video", data: att.data, mime_type: att.mime }];
  if (att.kind === "document" && att.data) return [{ type: "document", data: att.data, mime_type: "application/pdf" }];
  if (att.kind === "document" && att.text !== undefined) {
    // Text-like files are inlined as text.
    return [{ type: "text", text: `<attachment name="${att.name.replace(/"/g, "'")}">\n${att.text}\n</attachment>` }];
  }
  return [];
}

/**
 * Frontend payload -> stateless Interactions input (full history in every request, store: false).
 * Media goes before the text prompt, as the Gemini docs recommend. Consecutive turns of the
 * same role (e.g. after a failed response was dropped) are merged so turns always alternate.
 */
export function buildSteps(messages: ChatMessagePayload[]): Step[] {
  const steps: Step[] = [];
  for (const m of messages) {
    let step: Step;
    if (m.role === "assistant") {
      step = { type: "model_output", content: [{ type: "text", text: m.content }] };
    } else {
      const parts: Part[] = (m.attachments ?? []).flatMap(attachmentToParts);
      const text = m.content.trim().length > 0 ? m.content : parts.length > 0 ? "Please look at the attached file(s)." : "(empty message)";
      parts.push({ type: "text", text });
      step = { type: "user_input", content: parts };
    }
    const prev = steps[steps.length - 1];
    if (prev && prev.type === step.type) prev.content.push(...step.content);
    else steps.push(step);
  }
  return steps;
}
