"use client";

import { useState, type ComponentProps } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportPdfModal } from "./index";
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
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        <FileDown size={14} />
        {label}
      </Button>
      <ExportPdfModal
        open={open}
        onOpenChange={setOpen}
        documentType={documentType}
        documentId={documentId}
        filenameHint={filenameHint}
      />
    </>
  );
}
