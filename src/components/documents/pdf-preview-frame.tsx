"use client";

// In-app document viewer seam (ADR 0013, #464). The Estimate and Invoice Views
// both render the customer-facing PDF through this one frame — byte-for-byte the
// `/preview` document, a pure read, never an HTML re-render (the #385 intent).
// The mechanism is now an owned react-pdf island instead of the browser's native
// iframe chrome, so we can ship a slim page picker (#465) the native viewer never
// let us size. react-pdf evaluates pdfjs-dist at import time and cannot be
// server-rendered, so the island loads client-only via dynamic ssr:false — this
// `'use client'` wrapper is what lets a Server Component (the Estimate View) and a
// Client Component (the Invoice View) both render the same seam unchanged. The
// public `{ src, title }` interface is preserved exactly so neither consumer moves.
import dynamic from "next/dynamic";

const PdfDocumentViewer = dynamic(() => import("./pdf-document-viewer"), {
  ssr: false,
  loading: () => (
    <div className="text-muted-foreground py-12 text-center">
      Loading document…
    </div>
  ),
});

interface PdfPreviewFrameProps {
  src: string;
  title: string;
}

export function PdfPreviewFrame({ src, title }: PdfPreviewFrameProps) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-auto h-[80vh]">
      <PdfDocumentViewer src={src} title={title} />
    </div>
  );
}
