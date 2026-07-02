"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templateId: string | null;
  title?: string | null;
}

// Renders the template's PDF (with sample merge values + sample customer
// inputs) in an iframe via GET /api/settings/contract-templates/[id]/preview.
// The endpoint streams a fully stamped PDF — what the signer would see —
// and is the post-15d replacement for the old HTML preview flow.
export default function PreviewContractModal({ open, onOpenChange, templateId, title }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100vw-2rem,72rem)] sm:max-w-5xl max-h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-5 py-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText size={18} className="text-accent-text" />
            {title || "Contract Preview"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 bg-background/40">
          {open && templateId ? (
            <iframe
              key={templateId}
              src={`/api/settings/contract-templates/${templateId}/preview`}
              title="Contract preview"
              className="w-full h-[80vh] border-0"
            />
          ) : (
            <div className="text-center text-sm text-muted-foreground py-20">
              Pick a template to preview.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
