"use client";

import { useEffect, useMemo, useState } from "react";
import type { FileChange, GeneratedFile } from "@/types";
import { DownloadIcon } from "@/components/ui/icons";
import { downloadBytes } from "@/lib/chat/code-export";
import { findSecret, languageLabel } from "@/lib/chat/file-protocol";
import { buildVerifiedZip, planZip } from "@/lib/chat/zip";

const CHANGE_LABEL: Record<FileChange, string> = { new: "New", modified: "Modified", unchanged: "No changes" };

function extBadge(file: GeneratedFile): string {
  const ext = file.name.includes(".") ? file.name.split(".").pop() ?? "" : "";
  return (ext || languageLabel(file.language)).slice(0, 4).toUpperCase();
}

function FileCard({ file, change, onOpen }: { file: GeneratedFile; change?: FileChange; onOpen: () => void }) {
  const lines = file.content ? file.content.split("\n").length : 0;
  const status =
    file.status === "writing" ? `Writing… ${lines.toLocaleString("en")} lines` : file.status === "incomplete" ? "Incomplete draft" : "File available";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${file.path}`}
      className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition hover:border-cyan/50 hover:bg-raised active:scale-[0.99]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-bg font-mono text-[11px] font-semibold tracking-wide text-cyan">{extBadge(file)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm text-fg">{file.path}</span>
        <span className={`block truncate text-xs ${file.status === "incomplete" ? "text-amber-400" : "text-muted"}`}>
          {languageLabel(file.language)} · {status}
          {change && file.isComplete ? ` · ${CHANGE_LABEL[change]}` : ""}
        </span>
      </span>
      {file.status === "writing" && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-cyan" aria-hidden="true" />}
    </button>
  );
}

interface FileGroupProps {
  files: GeneratedFile[];
  changes?: Record<string, FileChange>;
  onOpen: (path: string) => void;
}

export function FileGroup({ files, changes, onOpen }: FileGroupProps) {
  return (
    <div className="my-3 flex flex-col gap-2" role="list" aria-label="Generated files">
      {files.map((f) => (
        <div role="listitem" key={f.id}>
          <FileCard file={f} change={changes?.[f.path]} onOpen={() => onOpen(f.path)} />
        </div>
      ))}
    </div>
  );
}

type ZipState = { phase: "building" } | { phase: "ready"; bytes: Uint8Array } | { phase: "error"; message: string };

/** One ZIP download. The archive is built and verified (read back, CRC, content) BEFORE the button is enabled. */
export function ZipButton({ label, zipName, files, primary }: { label: string; zipName: string; files: GeneratedFile[]; primary?: boolean }) {
  const plan = useMemo(() => planZip(files.map((f) => ({ path: f.path, content: f.content }))), [files]);
  const key = plan.entries.map((e) => `${e.path}:${e.content.length}`).join("|");
  const [state, setState] = useState<ZipState>({ phase: "building" });
  const [open, setOpen] = useState(false);
  const secrets = useMemo(() => files.filter((f) => findSecret(f.content)).map((f) => f.path), [files]);

  useEffect(() => {
    setState({ phase: "building" });
    const t = setTimeout(() => {
      const r = buildVerifiedZip(plan.entries);
      setState(r.ok ? { phase: "ready", bytes: r.bytes } : { phase: "error", message: r.error });
    }, 0);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={state.phase !== "ready"}
          onClick={() => state.phase === "ready" && downloadBytes(state.bytes, zipName)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition active:scale-95 disabled:pointer-events-none disabled:opacity-50 ${
            primary ? "bg-cyan text-bg hover:opacity-90" : "border border-line text-fg hover:bg-raised"
          }`}
        >
          <DownloadIcon width={14} height={14} />
          <span>{state.phase === "building" ? "Preparing ZIP…" : label}</span>
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline">
          {open ? "Hide" : "Show"} {plan.entries.length} file{plan.entries.length === 1 ? "" : "s"}
        </button>
      </div>
      {state.phase === "error" && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          The ZIP could not be created: {state.message}
        </p>
      )}
      {open && (
        <ul className="scroll-thin mt-2 max-h-40 overflow-auto font-mono text-xs text-muted">
          {plan.entries.map((e) => (
            <li key={e.path}>{e.path}</li>
          ))}
        </ul>
      )}
      {plan.renamed.length > 0 && <p className="mt-2 text-xs text-amber-400">Renamed to avoid a name clash on case-insensitive systems: {plan.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}.</p>}
      {plan.excluded.length > 0 && <p className="mt-2 text-xs text-amber-400">Left out of the ZIP: {plan.excluded.map((e) => `${e.path} (${e.reason})`).join(", ")}.</p>}
      {secrets.length > 0 && <p className="mt-2 text-xs text-amber-400">Possible secret found in {secrets.join(", ")}. Check it before uploading to GitHub.</p>}
    </div>
  );
}
