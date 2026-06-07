"use client";

import { useState, type ComponentProps } from "react";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DocumentType } from "@/lib/types";

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
    setExporting(true);
    try {
      const base = documentType === "estimate" ? "estimates" : "invoices";
      const res = await fetch(`/api/${base}/${documentId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error || `Export failed (${res.status})`);
        return;
      }
      const { download_url } = (await res.json()) as { download_url: string };
      const a = document.createElement("a");
      a.href = download_url;
      a.download = `${filenameHint}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("PDF exported");
    } catch {
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
