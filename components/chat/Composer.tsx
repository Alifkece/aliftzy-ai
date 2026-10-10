"use client";

import { useCallback, useEffect, useRef, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import type { Attachment } from "@/types";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import { PaperclipIcon, SendIcon, StopIcon } from "@/components/ui/icons";

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onFiles: (files: File[]) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
}

const ACCEPT = [
  "image/jpeg", "image/png", "image/webp", "application/pdf",
  "video/mp4", "video/webm", "video/quicktime",
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml", ".toml", ".ini", ".log",
  ".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".kt", ".go", ".rs", ".rb", ".php",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".swift", ".sh", ".sql", ".vue", ".svelte", ".mov",
].join(",");

const MAX_HEIGHT = 220;

export function Composer({
  value,
  onChange,
  attachments,
  onRemoveAttachment,
  onFiles,
  onSend,
  onStop,
  isStreaming,
  textareaRef,
  fileInputRef,
}: ComposerProps) {
  const innerRef = useRef<HTMLDivElement>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [textareaRef]);

  useEffect(resize, [value, resize]);

  const processing = attachments.some((a) => a.status === "processing");
  const hasReady = attachments.some((a) => a.status === "ready");
  const canSend = !isStreaming && !processing && (value.trim().length > 0 || hasReady);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      onFiles(files);
    }
  };

  return (
    <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 sm:px-6">
      <div
        ref={innerRef}
        className="mx-auto w-full max-w-3xl rounded-2xl border border-line bg-surface shadow-[0_8px_40px_-12px_rgb(0_0_0/0.5)] transition-colors duration-200 focus-within:border-violet/50"
      >
        {attachments.length > 0 && <AttachmentList attachments={attachments} onRemove={onRemoveAttachment} className="px-3 pt-3" />}

        <label htmlFor="composer-input" className="sr-only">
          Message Aliftzy Codes AI
        </label>
        <textarea
          id="composer-input"
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          placeholder="Message Aliftzy Codes AI…"
          enterKeyHint="send"
          className="scroll-thin block max-h-[220px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-relaxed text-fg outline-none placeholder:text-muted/70"
        />

        <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) onFiles(files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach files"
              title="Attach files"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-raised hover:text-fg active:scale-90"
            >
              <PaperclipIcon />
            </button>
          </div>

          <div className="relative h-9 w-9">
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              aria-label="Send message"
              tabIndex={isStreaming ? -1 : 0}
              className={`absolute inset-0 flex items-center justify-center rounded-xl bg-fg text-bg transition duration-200 hover:opacity-90 active:scale-90 disabled:bg-raised disabled:text-muted ${
                isStreaming ? "pointer-events-none scale-75 opacity-0" : "scale-100 opacity-100"
              }`}
            >
              <SendIcon />
            </button>
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              tabIndex={isStreaming ? 0 : -1}
              className={`absolute inset-0 flex items-center justify-center rounded-xl border border-line bg-raised text-fg transition duration-200 hover:border-violet/60 active:scale-90 ${
                isStreaming ? "scale-100 opacity-100" : "pointer-events-none scale-75 opacity-0"
              }`}
            >
              <StopIcon />
            </button>
          </div>
        </div>
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted/70">AI can make mistakes. Check important information.</p>
    </div>
  );
}
