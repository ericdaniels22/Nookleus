"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import type { ContractTemplate } from "@/lib/contracts/types";

interface Props {
  templateId: string;
  onUploaded: (tpl: ContractTemplate) => void;
}

export default function TemplatePdfUploadZone({ templateId, onUploaded }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (file.type !== "application/pdf") {
      toast.error("PDF files only");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("PDF must be 10 MB or smaller");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("pdf", file);
      const res = await fetch(`/api/settings/contract-templates/${templateId}/pdf`, {
        method: "POST",
        body: form,
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(
          j.error === "pdf_parse_failed"
            ? "Could not read this PDF — try re-saving from your PDF tool"
            : (j.error ?? "Upload failed"),
        );
        return;
      }
      onUploaded(j.template);
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div
      className="flex-1 m-6 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center text-center p-12 hover:border-[var(--brand-primary)]/40 transition-colors"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <Upload size={40} className="text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">Upload Contract PDF</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        Drop a PDF here, or click to choose. Drop merge fields and signature blocks onto the pages once it loads.
      </p>
      <label className="inline-flex items-center px-4 py-2 rounded-md bg-[var(--brand-primary)] text-white font-medium cursor-pointer hover:brightness-110 disabled:opacity-50">
        {busy ? "Uploading…" : "Choose PDF"}
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])}
        />
      </label>
      <p className="text-xs text-muted-foreground mt-4">10 MB max</p>
    </div>
  );
}
