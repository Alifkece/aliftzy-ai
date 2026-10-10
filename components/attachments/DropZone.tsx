"use client";

import { useCallback, useRef, useState, type DragEvent, type ReactNode } from "react";
import { UploadIcon } from "@/components/ui/icons";

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/** Wraps the chat area; shows an animated overlay while files are dragged over it. */
export function DropZone({ onFiles, disabled, children, className = "" }: DropZoneProps) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  const onDragEnter = useCallback((e: DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setActive(true);
  }, [disabled]);

  const onDragOver = useCallback((e: DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, [disabled]);

  const onDragLeave = useCallback((e: DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setActive(false);
  }, [disabled]);

  const onDrop = useCallback((e: DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  }, [disabled, onFiles]);

  return (
    <div
      className={`relative ${className}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {active && (
        <div className="pointer-events-none absolute inset-0 z-30 flex animate-fade items-center justify-center bg-bg/80 p-6 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-3xl animate-pop flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-violet/60 bg-violet/5">
            <div className="flex h-14 w-14 animate-float items-center justify-center rounded-2xl border border-line bg-surface text-violet">
              <UploadIcon width={26} height={26} />
            </div>
            <p className="text-base font-medium">Drop files to attach</p>
            <p className="text-sm text-muted">Images, PDFs, text, code, or video</p>
          </div>
        </div>
      )}
    </div>
  );
}
