"use client";

import { useState } from "react";
import { format } from "date-fns";
import {
  MessageAttachment,
  PhoneAttachmentLightbox,
  type PhoneAttachmentRef,
} from "./message-attachment";

// PRD #304 — Nookleus Phone. Slice 7 (#311) — Job-page message row.
//
// One text/MMS in the Job-page Messages section. Reuses the Phone-tab
// bubble treatment (inbound left/muted, outbound right/primary) and the
// shared MessageAttachment so a message reads the same wherever it
// appears, and adds a per-message context header (who it was with + when)
// because the Job section spans many conversations and numbers.

export interface JobMessageRowData {
  id: string;
  direction: "in" | "out";
  from_e164: string;
  to_e164: string;
  body: string | null;
  media_urls: PhoneAttachmentRef[];
  sent_at: string;
  counterpartyLabel: string;
}

export function JobMessageRow({ message }: { message: JobMessageRowData }) {
  const isIn = message.direction === "in";
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  const attachments = message.media_urls ?? [];
  return (
    <div className={`flex flex-col gap-1 ${isIn ? "items-start" : "items-end"}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/70">
          {message.counterpartyLabel}
        </span>
        <span>{format(new Date(message.sent_at), "MMM d, h:mm a")}</span>
      </div>
      <div
        className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
          isIn ? "bg-muted text-foreground" : "bg-primary text-primary-foreground"
        }`}
      >
        {message.body}
        {attachments.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {attachments.map((mu, idx) => (
              <li key={`${message.id}-att-${idx}`}>
                <MessageAttachment
                  attachment={mu}
                  onOpenLightbox={(p) => setLightboxPath(p)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {lightboxPath ? (
        <PhoneAttachmentLightbox
          path={lightboxPath}
          onClose={() => setLightboxPath(null)}
        />
      ) : null}
    </div>
  );
}
