"use client";

import { formatBytes } from "@/lib/files/rules";
import { CloseIcon, FileIcon, VideoIcon } from "@/components/ui/icons";
import type { Attachment, StoredAttachment } from "@/types";

interface ChipProps {
  attachment: Attachment | StoredAttachment;
  onRemove?: (id: string) => void;
}

function isLive(a: Attachment | StoredAttachment): a is Attachment {
  return "status" in a;
}

/** Reusable attachment preview: thumbnail/icon, filename, size, optional remove button. */
export function AttachmentChip({ attachment, onRemove }: ChipProps) {
  const live = isLive(attachment) ? attachment : null;
  const error = live?.status === "error";
  const preview = live?.preview;

  return (
    <div
      className={`group relative flex max-w-full animate-pop items-center gap-3 rounded-xl border px-2.5 py-2 transition ${
        error ? "border-red-500/40 bg-red-500/5" : "border-line bg-surface hover:border-violet/40"
      }`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-raised text-muted">
        {attachment.kind === "image" && preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : attachment.kind === "video" ? (
          <VideoIcon />
        ) : (
          <FileIcon />
        )}
      </div>
      <div className="min-w-0 pr-5">
        <p className="truncate text-[13px] font-medium leading-tight" title={attachment.name}>
          {attachment.name}
        </p>
        <p className={`mt-0.5 truncate text-xs ${error ? "text-red-400" : "text-muted"}`}>
          {error ? live?.error : formatBytes(attachment.size)}
        </p>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          aria-label={`Remove ${attachment.name}`}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-raised text-muted shadow transition hover:text-fg active:scale-90"
        >
          <CloseIcon width={11} height={11} />
        </button>
      )}
    </div>
  );
}
