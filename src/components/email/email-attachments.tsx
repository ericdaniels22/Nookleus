"use client";

import { Paperclip, Download, FileIcon } from "lucide-react";
import type { EmailAttachment } from "@/lib/types";

// Attachment list with download links via /api/email/attachments/{id}.
// Shared by the inbox reader and the Job View email row (#212).
//
// When `hasAttachments` is true but `attachments` is empty/undefined, the
// row is still mid-upload (sync's after() hook hasn't landed the files yet)
// — show a placeholder so the user knows attachments are coming.
export function EmailAttachments({
  attachments,
  hasAttachments,
}: {
  attachments: EmailAttachment[] | undefined;
  hasAttachments: boolean;
}) {
  if (!hasAttachments) return null;

  if (!attachments || attachments.length === 0) {
    return (
      <p className="text-xs text-[#999] flex items-center gap-2">
        <Paperclip size={12} />
        Downloading…
      </p>
    );
  }

  return (
    <>
      <p className="text-xs font-medium text-[#666] mb-2 flex items-center gap-1">
        <Paperclip size={12} />
        {attachments.length} attachment{attachments.length !== 1 ? "s" : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {attachments.map((att) => (
          <a
            key={att.id}
            href={`/api/email/attachments/${att.id}`}
            download={att.filename}
            className="inline-flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors group"
          >
            <FileIcon size={16} className="text-[#2B5EA7] shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-[#333] truncate max-w-[200px]">
                {att.filename}
              </p>
              {att.file_size && (
                <p className="text-[10px] text-[#999]">
                  {att.file_size > 1024 * 1024
                    ? `${(att.file_size / (1024 * 1024)).toFixed(1)}MB`
                    : `${(att.file_size / 1024).toFixed(0)}KB`}
                </p>
              )}
            </div>
            <Download size={14} className="text-[#999] group-hover:text-[#2B5EA7] shrink-0" />
          </a>
        ))}
      </div>
    </>
  );
}
