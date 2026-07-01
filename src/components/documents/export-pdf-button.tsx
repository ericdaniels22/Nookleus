"use client";

import { useState, type ComponentProps } from "react";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DocumentType } from "@/lib/types";
import { inStandaloneApp, shareOrDownloadFile } from "@/lib/share/share-or-download";

interface Props {
  documentType: DocumentType;
  documentId: string;
  filenameHint: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
  label?: string;
}

export function ExportPdfButton({
  documentType,
  documentId,
  filenameHint,
  variant = "outline",
  size = "sm",
  className,
  label = "Export PDF",
}: Props) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (exporting) return;

    // The pdf route returns a *cross-origin* Supabase signed URL. Browsers
    // ignore the <a download> attribute for cross-origin hrefs, so the old
    // anchor click just navigated the current tab to the PDF — ejecting the
    // SPA. On desktop we instead open the PDF in a new tab. The tab must be
    // opened *synchronously*, inside this click gesture and before any await,
    // or the popup blocker eats it (and post-await window.open is silently
    // dropped by the iOS WebView). We point it at the PDF once it's rendered.
    const app = inStandaloneApp();
    const pdfTab = app ? null : window.open("", "_blank");
    if (pdfTab) {
      // A held-open blank tab reads as broken; show that work is in flight.
      try {
        pdfTab.document.write(
          "<!doctype html><title>Preparing PDF…</title>" +
            "<body style='margin:0;font:16px system-ui,sans-serif;" +
            "display:flex;align-items:center;justify-content:center;" +
            "height:100dvh;color:#475569'>Preparing your PDF…",
        );
      } catch {
        /* writing to the popup is best-effort polish, never load-bearing */
      }
    }

    setExporting(true);
    try {
      const base = documentType === "estimate" ? "estimates" : "invoices";
      const res = await fetch(`/api/${base}/${documentId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        pdfTab?.close();
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error || `Export failed (${res.status})`);
        return;
      }
      const { download_url } = (await res.json()) as { download_url: string };
      const filename = `${filenameHint}.pdf`;

      if (app) {
        // Installed iOS app / standalone shell: the in-app WebView can neither
        // download nor open a usable tab, so hand the file to the native Share
        // sheet (Save to Files, AirDrop, …) instead.
        await shareOrDownloadFile({ url: download_url, filename, mode: "share" });
      } else if (pdfTab) {
        // Desktop: send the pre-opened tab to the freshly rendered PDF.
        pdfTab.location.href = download_url;
      } else {
        // Pre-open was blocked — best effort rather than ejecting the SPA.
        window.open(download_url, "_blank", "noopener,noreferrer");
      }
      toast.success("PDF exported");
    } catch {
      pdfTab?.close();
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleExport}
      disabled={exporting}
    >
      <FileDown size={14} />
      {exporting ? "Exporting…" : label}
    </Button>
  );
}
