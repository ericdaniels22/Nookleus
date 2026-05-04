"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { DocumentType, PdfPreset } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentType: DocumentType;
  documentId: string;
  filenameHint: string;
}

export function ExportPdfModal({
  open,
  onOpenChange,
  documentType,
  documentId,
  filenameHint,
}: Props) {
  const [presets, setPresets] = useState<PdfPreset[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/pdf-presets?document_type=${documentType}`);
        if (cancelled) return;
        if (!res.ok) {
          toast.error("Could not load presets");
          setLoading(false);
          return;
        }
        const { presets: list } = (await res.json()) as { presets: PdfPreset[] };
        if (cancelled) return;
        setPresets(list);
        const def = list.find((p) => p.is_default) ?? list[0];
        setSelectedId(def?.id ?? "");
      } catch {
        if (!cancelled) toast.error("Could not load presets");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, documentType]);

  async function handleExport() {
    if (!selectedId || exporting) return;
    setExporting(true);
    try {
      const route =
        documentType === "estimate"
          ? `/api/estimates/${documentId}/pdf`
          : `/api/invoices/${documentId}/pdf`;
      const res = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_id: selectedId }),
      });
      if (!res.ok) {
        toast.error("Could not generate PDF");
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
      onOpenChange(false);
    } catch {
      toast.error("Could not generate PDF");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export PDF</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-4">
          <Label htmlFor="preset-select">Preset</Label>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading presets…</p>
          ) : presets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No presets configured. Visit Settings → PDF Presets.
            </p>
          ) : (
            <select
              id="preset-select"
              className="w-full rounded border px-2 py-1.5"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.is_default ? " (default)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={!selectedId || exporting || loading}
          >
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
