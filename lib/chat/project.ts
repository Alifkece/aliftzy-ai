/**
 * Project state tracking for "send only changed files".
 *
 * The baseline for an assistant message is everything the project contained before it: text files the user
 * attached (path = file name) plus complete files from earlier assistant messages (later versions win,
 * explicit deletions remove). Each generated file is then classified new / modified / unchanged by comparing
 * real content, so a file whose content is identical is never reported (or zipped) as changed.
 */
import type { FileChange, GeneratedFile, Message } from "../../types";
import { normalizePath, parseResponse, type ParsedResponse } from "./file-protocol";

const norm = (s: string) => s.replace(/\r\n/g, "\n").replace(/\s+$/g, "");

export function classify(baseline: ReadonlyMap<string, string>, file: GeneratedFile): FileChange {
  const before = baseline.get(file.path);
  if (before === undefined) return "new";
  return norm(before) === norm(file.content) ? "unchanged" : "modified";
}

export interface MessageAnalysis {
  parsed: ParsedResponse;
  changes: Record<string, FileChange>;
  /** Deleted paths that really existed in the project before (explicit list, never silent). */
  deleted: string[];
}

const cache = new Map<string, ParsedResponse>();
export function parseCached(id: string, content: string, final: boolean): ParsedResponse {
  if (!content.includes("@@")) return parseResponse(content, { final });
  const key = `${id}:${content.length}:${final ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const parsed = parseResponse(content, { final });
  if (final) {
    if (cache.size > 300) cache.delete(cache.keys().next().value as string);
    cache.set(key, parsed);
  }
  return parsed;
}

export interface LiveText {
  name: string;
  text?: string;
}

export function analyzeConversation(
  messages: Message[],
  streamingId: string | null,
  getLiveText: (messageId: string) => LiveText[] | undefined,
): Map<string, MessageAnalysis> {
  const baseline = new Map<string, string>();
  const out = new Map<string, MessageAnalysis>();
  for (const m of messages) {
    if (m.role === "user") {
      for (const a of getLiveText(m.id) ?? []) {
        const p = normalizePath(a.name);
        if (p && a.text !== undefined) baseline.set(p, a.text);
      }
      continue;
    }
    const parsed = parseCached(m.id, m.content, m.id !== streamingId);
    const changes: Record<string, FileChange> = {};
    for (const f of parsed.files) changes[f.path] = classify(baseline, f);
    out.set(m.id, { parsed, changes, deleted: parsed.deleted.filter((d) => baseline.has(d)) });
    for (const f of parsed.files) if (f.isComplete) baseline.set(f.path, f.content);
    for (const d of parsed.deleted) baseline.delete(d);
  }
  return out;
}

/** The files that belong in a "changed files only" archive: complete AND new or really modified. */
export function changedFiles(files: GeneratedFile[], changes: Record<string, FileChange>): GeneratedFile[] {
  return files.filter((f) => f.isComplete && changes[f.path] !== "unchanged");
}
