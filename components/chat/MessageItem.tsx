"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Attachment, Message, StoredAttachment } from "@/types";
import { AICore } from "@/components/ui/AICore";
import { CheckIcon, CopyIcon, DownloadIcon, RefreshIcon } from "@/components/ui/icons";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import { Markdown } from "./Markdown";
import { PreviewModal } from "./PreviewModal";
import { downloadZip, extractFiles, isHtmlFile } from "@/lib/chat/code-export";

interface MessageItemProps {
  message: Message;
  streaming: boolean;
  isLast: boolean;
  disabled: boolean;
  getLive: (messageId: string) => Attachment[] | undefined;
  onRegenerate: () => void;
  onContinue: () => void;
}

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }, [text]);
  return { copied, copy };
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
function StreamStatus({ content }: { content: string }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const lines = content ? content.split("\n").length : 0;
  const stage = !content ? (secs < 3 ? "Connecting…" : "Thinking…") : "Writing…";
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

function MessageItemImpl({ message, streaming, isLast, disabled, getLive, onRegenerate, onContinue }: MessageItemProps) {
  const { copied, copy } = useCopy(message.content);
  const [previewing, setPreviewing] = useState(false);

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
  const files = !streaming && message.content.includes("```") ? extractFiles(message.content) : [];
  const canContinue = !streaming && isLast && message.content.length > 0 && (message.truncated || (message.error && !message.stopped));

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
            <Markdown content={message.content} />
            {streaming && <span className="stream-cursor" aria-hidden="true" />}
          </div>
        )}

        {streaming && <StreamStatus content={message.content} />}

        {message.truncated && !message.error && (
          <p className="mt-2 text-xs text-amber-400">The answer was cut off. Press Continue to finish it.</p>
        )}
        {message.stopped && <p className="mt-2 text-xs text-muted">Generation stopped.</p>}
        {message.error && (
          <div role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 px-3.5 py-2.5 text-sm text-red-400">
            {message.error}
          </div>
        )}

        {!streaming && (
          <div className="-ml-2 mt-2 flex flex-wrap items-center gap-0.5">
            {message.content && (
              <ActionButton label={copied ? "Copied" : "Copy response"} onClick={copy}>
                {copied ? <CheckIcon width={14} height={14} className="text-cyan" /> : <CopyIcon width={14} height={14} />}
                <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
              </ActionButton>
            )}
            {(files.length > 1 || files.some((f) => isHtmlFile(f.name))) && (
              <ActionButton label="Preview" onClick={() => setPreviewing(true)}>
                <span>{files.some((f) => isHtmlFile(f.name)) ? "Preview" : `View files (${files.length})`}</span>
              </ActionButton>
            )}
            {files.length > 1 && (
              <ActionButton label={`Download ${files.length} files as ZIP`} onClick={() => downloadZip(files)}>
                <DownloadIcon width={14} height={14} />
                <span>Download ZIP ({files.length})</span>
              </ActionButton>
            )}
            {canContinue && (
              <ActionButton label="Continue response" onClick={onContinue} disabled={disabled}>
                <RefreshIcon width={14} height={14} />
                <span>Continue</span>
              </ActionButton>
            )}
            {isLast && (
              <ActionButton label="Regenerate response" onClick={onRegenerate} disabled={disabled}>
                <RefreshIcon width={14} height={14} />
                <span>{message.error ? "Retry" : "Regenerate"}</span>
              </ActionButton>
            )}
          </div>
        )}
        {previewing && <PreviewModal files={files} onClose={() => setPreviewing(false)} />}
      </div>
    </article>
  );
}

export const MessageItem = memo(MessageItemImpl);
