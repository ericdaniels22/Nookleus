"use client";

import { useState, type ReactNode } from "react";

interface Props {
  pdfUrl: string;
  filename: string;
  className?: string;
  children: ReactNode;
}

// iOS PWA standalone ignores both the <a download> attribute and the
// route's Content-Disposition: attachment header — tapping a download
// link navigates the SPA to the PDF URL, which iOS renders inline with
// no Safari chrome and no Back gesture, leaving the user stuck until
// they hard-close the app. Web Share with a File pops the iOS Share
// Sheet directly (Save to Files, AirDrop, etc.) without ever showing
// the inline preview, so the PWA stays alive.
export default function DownloadPdfButton({
  pdfUrl,
  filename,
  className,
  children,
}: Props) {
  const [busy, setBusy] = useState(false);

  async function handle(e: React.MouseEvent<HTMLAnchorElement>) {
    if (typeof window === "undefined") return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari pre-PWA-spec property
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!standalone) return; // desktop / browser tab — let <a download> do its thing
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(pdfUrl);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
        } catch (err) {
          if ((err as DOMException)?.name !== "AbortError") throw err;
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("DownloadPdfButton failed:", err);
      window.location.href = pdfUrl;
    } finally {
      setBusy(false);
    }
  }

  return (
    <a
      href={pdfUrl}
      download={filename}
      onClick={handle}
      className={className}
      aria-busy={busy}
    >
      {children}
    </a>
  );
}
