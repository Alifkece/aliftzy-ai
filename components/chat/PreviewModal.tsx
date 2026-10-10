"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { bundleHtml, downloadText, downloadZip, isHtmlFile, type ExportFile } from "@/lib/chat/code-export";
import { DownloadIcon } from "@/components/ui/icons";

interface PreviewModalProps {
  files: ExportFile[];
  onClose: () => void;
}

type Tab = "preview" | "code";
type Device = "desktop" | "mobile";

export function PreviewModal({ files, onClose }: PreviewModalProps) {
  const entries = useMemo(() => files.filter((f) => isHtmlFile(f.name)), [files]);
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<Tab>(entries.length > 0 ? "preview" : "code");
  const [device, setDevice] = useState<Device>("desktop");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const file = files[Math.min(selected, files.length - 1)];
  const canPreview = isHtmlFile(file.name);
  const activeTab: Tab = canPreview ? tab : "code";
  const srcDoc = useMemo(() => (canPreview ? bundleHtml(files, file) : ""), [canPreview, files, file]);

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-lg px-3 py-1.5 text-xs transition ${activeTab === id ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
    >
      {label}
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Preview">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden border-line bg-surface sm:h-[88vh] sm:max-w-6xl sm:rounded-2xl sm:border">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
          <div className="flex items-center gap-1">
            {canPreview && tabBtn("preview", "Preview")}
            {tabBtn("code", "Code")}
          </div>
          {activeTab === "preview" && (
            <div className="hidden items-center gap-1 sm:flex">
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
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => (files.length > 1 ? downloadZip(files) : downloadText(file.name, file.content))}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted transition hover:bg-raised hover:text-fg"
            >
              <DownloadIcon width={14} height={14} />
              <span>{files.length > 1 ? "ZIP" : "Download"}</span>
            </button>
            <button type="button" onClick={onClose} aria-label="Close preview" className="rounded-lg px-2.5 py-1.5 text-sm text-muted transition hover:bg-raised hover:text-fg">
              ✕
            </button>
          </div>
        </div>

        {files.length > 1 && (
          <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-line px-3 py-2 sm:px-4">
            {files.map((f, i) => (
              <button
                key={f.name}
                type="button"
                onClick={() => setSelected(i)}
                className={`shrink-0 rounded-lg px-2.5 py-1 font-mono text-xs transition ${i === selected ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto bg-bg">
          {activeTab === "preview" ? (
            <div className="flex h-full justify-center bg-black/20">
              <iframe
                key={file.name + srcDoc.length}
                title={`Preview ${file.name}`}
                srcDoc={srcDoc}
                sandbox="allow-scripts allow-forms allow-modals"
                referrerPolicy="no-referrer"
                className={`h-full border-0 bg-white ${device === "mobile" ? "w-[390px] max-w-full" : "w-full"}`}
              />
            </div>
          ) : (
            <pre className="scroll-thin m-0 min-h-full overflow-auto p-4 font-mono text-xs leading-relaxed text-fg">{file.content}</pre>
          )}
        </div>
        {activeTab === "preview" && (
          <p className="border-t border-line px-4 py-1.5 text-[11px] text-muted">Runs in a sandbox: no access to this app or your data.</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
