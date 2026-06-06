"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import { configurePdfjs } from "@/lib/pdf/configure-pdfjs";

// ADR 0013 constraint 1: the /preview routes stream a whole-buffer 200 with no
// Accept-Ranges, so the viewer disables Range/stream negotiation — otherwise
// Chrome can stall on partial-content fetching. Hoisted to a stable reference
// so react-pdf does not re-fetch the document on every render.
const DOCUMENT_OPTIONS = { disableStream: true, disableRange: true } as const;

// Mirror the contracts viewer: each page renders at the measured container
// width minus a small gutter, so the document fits without a horizontal
// scrollbar regardless of viewport size.
const HORIZONTAL_GUTTER_PX = 16;

interface PdfDocumentViewerProps {
  src: string;
  title: string;
}

export default function PdfDocumentViewer({ src }: PdfDocumentViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  // Bumped by Retry: re-keying <Document> forces a full remount, which clears
  // the error slot and re-fetches the /preview bytes from scratch.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    configurePdfjs();
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageWidth = Math.max(1, containerWidth - HORIZONTAL_GUTTER_PX);

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-6 py-6">
      <Document
        key={reloadKey}
        file={src}
        options={DOCUMENT_OPTIONS}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        loading={
          <div className="text-muted-foreground py-12">Loading document…</div>
        }
        error={
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-muted-foreground">
              {"We couldn't load this document."}
            </p>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Retry
            </button>
          </div>
        }
      >
        {Array.from({ length: numPages }, (_, i) => (
          <Page
            key={i + 1}
            pageNumber={i + 1}
            width={pageWidth}
            renderAnnotationLayer={false}
            renderTextLayer={false}
          />
        ))}
      </Document>
    </div>
  );
}
