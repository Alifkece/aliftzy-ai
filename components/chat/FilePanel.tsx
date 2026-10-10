"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FileChange, GeneratedFile } from "@/types";
import { CheckIcon, CloseIcon, CopyIcon, DownloadIcon } from "@/components/ui/icons";
import { buildPreviewDoc, copyText, downloadFile, isPreviewable, previewUnavailableReason, resolveRef } from "@/lib/chat/code-export";
import { languageLabel } from "@/lib/chat/file-protocol";
import { HighlightedCode } from "./HighlightedCode";

interface FilePanelProps {
  files: GeneratedFile[];
  initialPath: string;
  changes?: Record<string, FileChange>;
  onClose: () => void;
}

type Tab = "preview" | "code";
type Device = "desktop" | "mobile";
type CopyState = "idle" | "copied" | "failed";

/** Above this size the code view skips syntax highlighting to stay responsive. */
const HIGHLIGHT_MAX_CHARS = 250_000;

export function FilePanel({ files, initialPath, changes, onClose }: FilePanelProps) {
  const [selectedPath, setSelectedPath] = useState(initialPath);
  const file = files.find((f) => f.path === selectedPath) ?? files[0];
  const canPreview = !!file && file.isComplete && isPreviewable(file.path);
  const [tab, setTab] = useState<Tab>(canPreview ? "preview" : "code");
  const [device, setDevice] = useState<Device>("desktop");
  const [copy, setCopy] = useState<CopyState>("idle");
  const [loading, setLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [highlightReady, setHighlightReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only complete files can run: a partial file is never previewed as if it were final.
  const exportFiles = useMemo(() => files.filter((f) => f.isComplete).map((f) => ({ name: f.path, content: f.content })), [files]);
  const srcDoc = useMemo(() => (canPreview && file ? buildPreviewDoc(exportFiles, file.path) : ""), [canPreview, file, exportFiles]);
  const activeTab: Tab = canPreview ? tab : "code";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [onClose]);

  // Switching file: reset per-file UI state; open previewable HTML on its preview.
  useEffect(() => {
    setLoading(true);
    setPreviewError(null);
    setNotice(null);
    setCopy("idle");
    setTab(file && file.isComplete && isPreviewable(file.path) ? "preview" : "code");
  }, [file?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Large files: paint plain text first, then upgrade to highlighted code.
  useEffect(() => {
    setHighlightReady(false);
    const t = setTimeout(() => setHighlightReady(true), 0);
    return () => clearTimeout(t);
  }, [file?.path, file?.content.length]);

  // Messages from the sandboxed preview: script errors and local page navigation. Only our own iframe is trusted as a source.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const d = e.data as { __aliftzy?: string; message?: unknown; href?: unknown } | null;
      if (!d || typeof d !== "object") return;
      if (d.__aliftzy === "error" && typeof d.message === "string") setPreviewError(d.message.slice(0, 300));
      else if (d.__aliftzy === "external") setNotice("External links are disabled inside the preview.");
      else if (d.__aliftzy === "navigate" && typeof d.href === "string" && file) {
        const target = resolveRef(exportFiles, file.path, d.href);
        if (target && /\.html?$/i.test(target.name)) setSelectedPath(target.name);
        else setNotice(`"${d.href.slice(0, 80)}" is not part of the generated files.`);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [exportFiles, file]);

  const onCopy = useCallback(async () => {
    if (!file) return;
    const ok = await copyText(file.content);
    setCopy(ok ? "copied" : "failed");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopy("idle"), 2200);
  }, [file]);

  if (!file) return null;

  const lines = file.content ? file.content.split("\n").length : 0;
  const draft = !file.isComplete;
  const tabBtn = (id: Tab, label: string, disabled = false) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-xs transition disabled:opacity-40 ${activeTab === id ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
    >
      {label}
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`File ${file.path}`}>
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden border-line bg-surface sm:h-[88vh] sm:max-w-6xl sm:rounded-2xl sm:border">
        {/* Header: identity + actions */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close file" className="rounded-lg p-1.5 text-muted transition hover:bg-raised hover:text-fg">
            <CloseIcon width={16} height={16} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm text-fg">{file.name}</p>
            <p className="truncate text-[11px] text-muted">
              {file.path !== file.name && <span className="font-mono">{file.path} · </span>}
              {languageLabel(file.language)} · {lines.toLocaleString("en")} lines · {file.content.length.toLocaleString("en")} chars
              {changes?.[file.path] && changes[file.path] !== "unchanged" ? ` · ${changes[file.path]}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onCopy}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted transition hover:bg-raised hover:text-fg active:scale-95"
            >
              {copy === "copied" ? <CheckIcon width={14} height={14} className="text-cyan" /> : <CopyIcon width={14} height={14} />}
              <span aria-live="polite" className={copy === "failed" ? "text-red-400" : undefined}>
                {copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed" : "Copy"}
              </span>
            </button>
            <button
              type="button"
              disabled={draft}
              title={draft ? "This file is an unfinished draft and cannot be downloaded as a final file." : `Download ${file.name}`}
              onClick={() => downloadFile(file.path, file.content)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted transition hover:bg-raised hover:text-fg active:scale-95 disabled:pointer-events-none disabled:opacity-40"
            >
              <DownloadIcon width={14} height={14} />
              <span>Download</span>
            </button>
          </div>
        </div>

        {/* File picker (multi-file) */}
        {files.length > 1 && (
          <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-line px-3 py-2 sm:px-4" role="tablist" aria-label="Files">
            {files.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={f.path === file.path}
                onClick={() => setSelectedPath(f.path)}
                className={`shrink-0 rounded-lg px-2.5 py-1 font-mono text-xs transition ${f.path === file.path ? "bg-raised text-fg" : "text-muted hover:text-fg"} ${f.isComplete ? "" : "text-amber-400"}`}
              >
                {f.path}
              </button>
            ))}
          </div>
        )}

        {/* View tabs */}
        <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-1.5 sm:px-4">
          {tabBtn("preview", "Preview", !canPreview)}
          {tabBtn("code", "Code")}
          {activeTab === "preview" && (
            <div className="ml-2 hidden items-center gap-1 sm:flex">
              {(["desktop", "mobile"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDevice(d)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs capitalize transition ${device === d ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          {draft && <span className="ml-auto text-xs text-amber-400">{file.status === "writing" ? "Still being written…" : "Incomplete draft: not a final file"}</span>}
        </div>

        {/* Body */}
        <div className="relative min-h-0 flex-1 overflow-auto bg-bg">
          {activeTab === "preview" ? (
            <div className="flex h-full justify-center bg-black/20">
              <iframe
                key={`${file.path}:${srcDoc.length}`}
                ref={iframeRef}
                title={`Preview ${file.path}`}
                srcDoc={srcDoc}
                onLoad={() => setLoading(false)}
                sandbox="allow-scripts allow-forms allow-modals"
                referrerPolicy="no-referrer"
                className={`h-full border-0 bg-white ${device === "mobile" ? "w-[390px] max-w-full" : "w-full"}`}
              />
              {loading && <p className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-line bg-raised px-3 py-1 text-xs text-muted">Loading preview…</p>}
            </div>
          ) : (
            <>
              {!canPreview && (
                <p className="border-b border-line px-4 py-2 text-xs text-muted">
                  {draft ? "Preview is disabled until the file is complete." : previewUnavailableReason(file.path)}
                </p>
              )}
              {file.content.length > HIGHLIGHT_MAX_CHARS ? (
                <pre className="file-code scroll-thin">{file.content}</pre>
              ) : highlightReady ? (
                <HighlightedCode code={file.content} language={file.language} />
              ) : (
                <pre className="file-code scroll-thin">{file.content}</pre>
              )}
              {file.content.length > HIGHLIGHT_MAX_CHARS && <p className="px-4 pb-3 text-[11px] text-muted">Syntax highlighting is off for very long files.</p>}
            </>
          )}
        </div>

        {/* Footer: honest runtime notes */}
        {activeTab === "preview" && (
          <div className="border-t border-line px-4 py-1.5 text-[11px] text-muted">
            {previewError ? (
              <p role="alert" className="text-red-400">
                Script error in preview: {previewError}
              </p>
            ) : notice ? (
              <p>{notice}</p>
            ) : (
              <p>Runs in a sandbox with no access to this app or your data. Backend code, build steps and browser storage are not available here.</p>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
