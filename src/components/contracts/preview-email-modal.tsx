"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Mail, Loader2, AlertTriangle } from "lucide-react";
import type { ContractEmailSettings } from "@/lib/contracts/types";
import type { ContractEmailFrameInput } from "@/lib/contracts/email-frame";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  // Real job → resolves that customer's merge data; omit for a sample preview.
  jobId?: string | null;
  kind?: ContractEmailFrameInput["kind"];
  // Unsaved editor state (message + knobs) reflected in the rendered card.
  draftSettings?: Partial<ContractEmailSettings>;
  documentTitle?: string | null;
  title?: string | null;
}

// Renders the real branded contract email — the exact card the recipient will
// get, with this job/customer's merge data resolved — via POST
// /api/contracts/email-preview, shown in an isolated iframe (#695, ADR 0017 §6).
// Distinct from PreviewContractModal, which previews the signed PDF document.
export default function PreviewEmailModal({
  open,
  onOpenChange,
  jobId,
  kind = "signing_request",
  draftSettings,
  documentTitle,
  title,
}: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setHtml(null);
      setError(null);
      try {
        const r = await fetch("/api/contracts/email-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: jobId ?? undefined,
            kind,
            draftSettings,
            documentTitle: documentTitle ?? undefined,
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((data as { error?: string }).error || "Preview failed");
        if (!cancelled) setHtml((data as { html: string }).html);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Preview failed");
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, jobId, kind, draftSettings, documentTitle]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100vw-2rem,48rem)] sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-5 py-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Mail size={18} className="text-[var(--brand-primary)]" />
            {title || "Email Preview"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 bg-background/40">
          {error ? (
            <div className="flex items-center justify-center gap-2 text-sm text-amber-300 py-20">
              <AlertTriangle size={16} /> {error}
            </div>
          ) : html === null ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-20">
              <Loader2 size={16} className="animate-spin" /> Rendering email…
            </div>
          ) : (
            <iframe
              srcDoc={html}
              title="Email preview"
              className="w-full h-[70vh] border-0 bg-white"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
