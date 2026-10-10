"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Attachment, FileChange, GeneratedFile, Message, StoredAttachment } from "@/types";
import { AICore } from "@/components/ui/AICore";
import { CheckIcon, CopyIcon, RefreshIcon } from "@/components/ui/icons";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import { Markdown } from "./Markdown";
import { FilePanel } from "./FilePanel";
import { FileGroup, ZipButton } from "./FileCard";
import { copyText } from "@/lib/chat/code-export";
import { changedFiles, parseCached, type MessageAnalysis } from "@/lib/chat/project";

interface MessageItemProps {
  message: Message;
  streaming: boolean;
  isLast: boolean;
  disabled: boolean;
  getLive: (messageId: string) => Attachment[] | undefined;
  onRegenerate: () => void;
  /** Files, change classification and deletions for this message (computed once per list render). */
  analysis?: MessageAnalysis;
  /** What the user's request asked for; used to emphasise the matching download. */
  wantsZip: boolean;
  changedOnly: boolean;
}

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = useCallback(async () => {
    const ok = await copyText(text);
    setFailed(!ok);
    setCopied(ok);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 1800);
  }, [text]);
  return { copied, failed, copy };
}

function ActionButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted transition hover:bg-raised hover:text-fg active:scale-95 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Live progress while generating: stage, elapsed seconds, size written so far. */
function StreamStatus({ content, progress }: { content: string; progress?: string }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const lines = content ? content.split("\n").length : 0;
  const stage = progress ?? (!content ? (secs < 3 ? "Connecting…" : "Thinking…") : "Writing…");
  return (
    <p className="mt-2 flex items-center gap-2 text-xs text-muted" role="status">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" aria-hidden="true" />
      <span>{stage}</span>
      <span className="tabular-nums">
        {secs}s{content ? ` · ${lines} lines · ${content.length.toLocaleString("en")} chars` : ""}
      </span>
    </p>
  );
}

function sameChanges(a?: Record<string, FileChange>, b?: Record<string, FileChange>): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

function MessageItemImpl({ message, streaming, isLast, disabled, getLive, onRegenerate, analysis, wantsZip, changedOnly }: MessageItemProps) {
  const parsed = analysis?.parsed ?? parseCached(message.id, message.content, !streaming);
  const changes = analysis?.changes;
  const hasFiles = parsed.files.length > 0;
  const { copied, failed, copy } = useCopy(hasFiles ? parsed.prose : message.content);
  const [openPath, setOpenPath] = useState<string | null>(null);

  if (message.role === "user") {
    const live = getLive(message.id);
    const attachments: (Attachment | StoredAttachment)[] = live ?? message.attachments ?? [];
    return (
      <article className="flex animate-rise flex-col items-end gap-2" aria-label="You">
        {attachments.length > 0 && <AttachmentList attachments={attachments} className="max-w-[85%] justify-end" />}
        {message.content && (
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-line bg-raised px-4 py-2.5 text-[15px] leading-relaxed">
            {message.content}
          </div>
        )}
      </article>
    );
  }

  const waiting = streaming && message.content.length === 0;
  const complete: GeneratedFile[] = parsed.files.filter((f) => f.isComplete);
  const unfinished = parsed.files.length - complete.length;
  const changed = changedFiles(parsed.files, changes ?? {});
  const hasBaseline = Object.values(changes ?? {}).some((c) => c !== "new");
  const counts = { new: 0, modified: 0, unchanged: 0 };
  for (const f of complete) counts[changes?.[f.path] ?? "new"] += 1;
  const showZipArea = !streaming && hasFiles && (wantsZip || changedOnly || complete.length > 1 || unfinished > 0);

  // Consecutive file segments render as one list; marker lines and file bodies never appear as chat text.
  const blocks: ({ kind: "text"; text: string } | { kind: "files"; files: GeneratedFile[] })[] = [];
  for (const seg of parsed.segments) {
    const last = blocks[blocks.length - 1];
    if (seg.kind === "file") {
      if (last?.kind === "files") last.files.push(seg.file);
      else blocks.push({ kind: "files", files: [seg.file] });
    } else blocks.push({ kind: "text", text: seg.text });
  }
  const lastIsText = blocks[blocks.length - 1]?.kind === "text";

  return (
    <article className="flex animate-rise gap-3.5" aria-label="Aliftzy Codes AI">
      <div className="mt-0.5 shrink-0">
        <AICore size={30} active={streaming} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-[13px] font-medium text-muted">Aliftzy Codes AI</p>
        {waiting ? (
          <span className="stream-cursor" aria-hidden="true" />
        ) : (
          <div className="prose-chat text-[15px]">
            {hasFiles ? (
              blocks.map((b, i) =>
                b.kind === "text" ? (
                  <Markdown key={i} content={b.text} />
                ) : (
                  <FileGroup key={i} files={b.files} changes={changes} onOpen={setOpenPath} />
                ),
              )
            ) : (
              <Markdown content={message.content} />
            )}
            {streaming && (lastIsText || !hasFiles) && <span className="stream-cursor" aria-hidden="true" />}
          </div>
        )}

        {streaming && <StreamStatus content={message.content} progress={message.progress} />}

        {!streaming && parsed.deleted.length > 0 && (
          <div className="mt-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted">
            <p className="font-medium text-fg">Files to delete</p>
            <p className="mt-0.5 font-mono">{parsed.deleted.join(", ")}</p>
            <p className="mt-1">Nothing is deleted automatically. Remove these files from your project yourself.</p>
          </div>
        )}

        {!streaming && hasBaseline && complete.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {counts.new} new · {counts.modified} modified · {counts.unchanged} unchanged
          </p>
        )}

        {showZipArea && (
          <div className="mt-3 flex flex-col gap-2">
            {unfinished > 0 ? (
              <p className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-400">
                ZIP is unavailable: {unfinished} file{unfinished === 1 ? " is" : "s are"} unfinished. Unfinished files are drafts and are never exported as final files. Use Retry to generate them again.
              </p>
            ) : changedOnly ? (
              changed.length > 0 ? (
                <>
                  <ZipButton primary label={`Download ZIP · changed only (${changed.length})`} zipName="changed-files.zip" files={changed} />
                  {complete.length > changed.length && <ZipButton label={`Download ZIP · all files (${complete.length})`} zipName="aliftzy-project.zip" files={complete} />}
                </>
              ) : (
                <p className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted">None of the files differ from the version you already have, so there is nothing to put in a changed-files ZIP.</p>
              )
            ) : (
              <>
                <ZipButton primary={wantsZip} label={`Download ZIP (${complete.length} file${complete.length === 1 ? "" : "s"})`} zipName="aliftzy-project.zip" files={complete} />
                {hasBaseline && changed.length > 0 && changed.length < complete.length && (
                  <ZipButton label={`Download ZIP · changed only (${changed.length})`} zipName="changed-files.zip" files={changed} />
                )}
              </>
            )}
          </div>
        )}

        {!streaming && unfinished > 0 && !message.error && !message.stopped && (
          <p className="mt-2 text-xs text-amber-400">Some files are unfinished drafts and cannot be downloaded. Use Retry to generate them again.</p>
        )}
        {message.stopped && <p className="mt-2 text-xs text-muted">Generation stopped.{unfinished > 0 ? " Unfinished files were kept as drafts." : ""}</p>}
        {message.error && (
          <div role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 px-3.5 py-2.5 text-sm text-red-400">
            {message.error}
          </div>
        )}

        {!streaming && (
          <div className="-ml-2 mt-2 flex flex-wrap items-center gap-0.5">
            {message.content && (
              <ActionButton label={copied ? "Copied" : failed ? "Copy failed" : "Copy response"} onClick={copy}>
                {copied ? <CheckIcon width={14} height={14} className="text-cyan" /> : <CopyIcon width={14} height={14} />}
                <span aria-live="polite" className={failed ? "text-red-400" : undefined}>
                  {copied ? "Copied" : failed ? "Copy failed" : "Copy"}
                </span>
              </ActionButton>
            )}
            {isLast && (
              <ActionButton label="Regenerate response" onClick={onRegenerate} disabled={disabled}>
                <RefreshIcon width={14} height={14} />
                <span>{message.error || unfinished > 0 ? "Retry" : "Regenerate"}</span>
              </ActionButton>
            )}
          </div>
        )}
        {openPath && <FilePanel files={parsed.files} initialPath={openPath} changes={changes} onClose={() => setOpenPath(null)} />}
      </div>
    </article>
  );
}

export const MessageItem = memo(MessageItemImpl, (a, b) =>
  a.message === b.message &&
  a.streaming === b.streaming &&
  a.isLast === b.isLast &&
  a.disabled === b.disabled &&
  a.wantsZip === b.wantsZip &&
  a.changedOnly === b.changedOnly &&
  a.getLive === b.getLive &&
  a.onRegenerate === b.onRegenerate &&
  a.analysis?.parsed === b.analysis?.parsed &&
  sameChanges(a.analysis?.changes, b.analysis?.changes),
);
