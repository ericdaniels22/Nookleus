"use client";

import { useEffect, useState } from "react";
import { isMmsImageMediaType } from "@/lib/phone/mms-attachments";

// PRD #304 — Nookleus Phone. Slice 6 (#310) / slice 7 (#311).
//
// Shared message-attachment rendering, used by both the Phone-tab thread
// and the Job-page Messages section so an MMS reads identically wherever
// it appears. Images load via the signed-URL endpoint and click open the
// lightbox; non-image media is a labelled download link (also via the
// signed URL).

export interface PhoneAttachmentRef {
  storage_path: string;
  media_type: string;
  filename?: string;
}

export function MessageAttachment({
  attachment,
  onOpenLightbox,
}: {
  attachment: PhoneAttachmentRef;
  onOpenLightbox: (path: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/phone/attachments?path=${encodeURIComponent(attachment.storage_path)}`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as { url: string };
      if (!cancelled) setUrl(body.url);
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment.storage_path]);

  if (isMmsImageMediaType(attachment.media_type)) {
    return (
      <button
        type="button"
        aria-label={`Open attachment ${attachment.filename ?? ""}`.trim()}
        onClick={() => onOpenLightbox(attachment.storage_path)}
        className="block overflow-hidden rounded border border-border bg-background"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url ?? ""}
          alt={`attachment ${attachment.filename ?? ""}`.trim()}
          className="block h-32 w-32 object-cover"
        />
      </button>
    );
  }
  const label = attachment.filename ?? "Download attachment";
  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground hover:underline"
    >
      {label}
    </a>
  );
}

export function PhoneAttachmentLightbox({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/phone/attachments?path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as { url: string };
      if (!cancelled) setUrl(body.url);
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-label="Attachment preview"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url ?? ""}
        alt="attachment full size"
        className="max-h-[90vh] max-w-[90vw] rounded shadow-lg"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
