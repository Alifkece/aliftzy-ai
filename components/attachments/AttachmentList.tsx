"use client";

import { AttachmentChip } from "./AttachmentChip";
import type { Attachment, StoredAttachment } from "@/types";

interface ListProps {
  attachments: (Attachment | StoredAttachment)[];
  onRemove?: (id: string) => void;
  className?: string;
}

export function AttachmentList({ attachments, onRemove, className = "" }: ListProps) {
  if (attachments.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`} aria-label="Attachments">
      {attachments.map((a) => (
        <li key={a.id} className="max-w-full">
          <AttachmentChip attachment={a} onRemove={onRemove} />
        </li>
      ))}
    </ul>
  );
}
