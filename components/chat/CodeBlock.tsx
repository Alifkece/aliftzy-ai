"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon, DownloadIcon } from "@/components/ui/icons";
import { FilePanel } from "./FilePanel";
import { copyText, downloadFile } from "@/lib/chat/code-export";
import { extensionFor, makeFile } from "@/lib/chat/file-protocol";

interface CodeBlockProps {
  language: string;
  text: string;
  filename?: string;
  children: ReactNode;
}

export function CodeBlock({ language, text, filename, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const [failed, setFailed] = useState(false);
  const copy = useCallback(async () => {
    const ok = await copyText(text);
    setCopied(ok);
    setFailed(!ok);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 1800);
  }, [text]);

  const [preview, setPreview] = useState(false);
  const isHtml = language.toLowerCase() === "html";
  const saveName = filename || `code.${extensionFor(language)}`;

  return (
    <div className="code-block group my-4 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="min-w-0 truncate font-mono text-xs tracking-wide text-muted">{filename || (language || "text").toLowerCase()}</span>
        <div className="flex shrink-0 items-center gap-1">
        {isHtml && (
          <button
            type="button"
            onClick={() => setPreview(true)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-cyan transition hover:bg-raised active:scale-95"
          >
            Preview
          </button>
        )}
        <button
          type="button"
          onClick={() => downloadFile(saveName, text)}
          aria-label={`Download ${saveName}`}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted transition hover:bg-raised hover:text-fg active:scale-95"
        >
          <DownloadIcon width={14} height={14} />
          <span>Download</span>
        </button>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : failed ? "Copy failed" : "Copy code"}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted transition hover:bg-raised hover:text-fg active:scale-95"
        >
          <span className="relative block h-[14px] w-[14px]">
            <CopyIcon
              width={14}
              height={14}
              className={`absolute inset-0 transition duration-200 ${copied ? "scale-50 opacity-0" : "scale-100 opacity-100"}`}
            />
            <CheckIcon
              width={14}
              height={14}
              className={`absolute inset-0 text-cyan transition duration-200 ${copied ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
            />
          </span>
          <span aria-live="polite" className={failed ? "text-red-400" : undefined}>{copied ? "Copied" : failed ? "Copy failed" : "Copy"}</span>
        </button>
        </div>
      </div>
      {children}
      {preview && (
        <FilePanel
          files={[makeFile(saveName.endsWith(".html") ? saveName : "index.html", "html", text)]}
          initialPath={saveName.endsWith(".html") ? saveName : "index.html"}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}
