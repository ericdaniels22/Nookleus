"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { configurePdfjs } from "@/lib/pdf/configure-pdfjs";
import type { OverlayField, PdfPage } from "@/lib/contracts/types";

interface Props {
  pdfUrl: string;
  pdfPages: PdfPage[];
  overlayFields: OverlayField[];
  scale?: number;
  zoom?: number;
  renderOverlay: (args: {
    page: PdfPage;
    fields: OverlayField[];
    scale: number;
    onPageDrop: (page: number, xPt: number, yPt: number, dataTransfer: DataTransfer) => void;
  }) => React.ReactNode;
  onPageDrop?: (page: number, xPt: number, yPt: number, dataTransfer: DataTransfer) => void;
}

// Reserves a small horizontal gutter so the page's drop-shadow doesn't get clipped by `overflow:auto`
const HORIZONTAL_GUTTER_PX = 16;

export default function PdfCanvas({
  pdfUrl,
  pdfPages,
  overlayFields,
  scale: maxScale = 1.5,
  zoom = 1,
  renderOverlay,
  onPageDrop,
}: Props) {
  const [numPages, setNumPages] = useState<number>(pdfPages.length);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

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

  const maxPageWidthPt = Math.max(1, ...pdfPages.map((p) => p.width_pt));
  const fitScale =
    containerWidth > 0
      ? Math.max(0.25, (containerWidth - HORIZONTAL_GUTTER_PX) / maxPageWidthPt)
      : maxScale;
  const scale = Math.min(maxScale, fitScale) * zoom;

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-6 py-6">
      {containerWidth > 0 ? (
        <Document
          file={pdfUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={(error) => console.error("[pdf-canvas] Document onLoadError:", error)}
          loading={<div className="text-muted-foreground">Loading PDF…</div>}
          error={<div className="text-red-500">Failed to load PDF</div>}
        >
          {Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1;
            const meta = pdfPages.find((p) => p.page === pageNum);
            if (!meta) return null;
            const fields = overlayFields.filter((f) => f.page === pageNum);
            return (
              <div
                key={pageNum}
                className="relative shadow-lg"
                style={{ width: meta.width_pt * scale, height: meta.height_pt * scale }}
              >
                <Page
                  pageNumber={pageNum}
                  width={meta.width_pt * scale}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                />
                <div
                  className="absolute inset-0"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!onPageDrop) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const xPt = (e.clientX - rect.left) / scale;
                    const yPt = (e.clientY - rect.top) / scale;
                    onPageDrop(pageNum, xPt, yPt, e.dataTransfer);
                  }}
                >
                  {renderOverlay({
                    page: meta,
                    fields,
                    scale,
                    onPageDrop: onPageDrop ?? (() => {}),
                  })}
                </div>
              </div>
            );
          })}
        </Document>
      ) : (
        <div className="text-muted-foreground py-12">Loading PDF…</div>
      )}
    </div>
  );
}
