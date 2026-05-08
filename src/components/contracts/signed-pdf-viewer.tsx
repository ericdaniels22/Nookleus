"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { configurePdfjs } from "@/lib/pdf/configure-pdfjs";

interface Props {
  pdfUrl: string;
}

const HORIZONTAL_GUTTER_PX = 16;

export default function SignedPdfViewer({ pdfUrl }: Props) {
  const [numPages, setNumPages] = useState(0);
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

  const pageWidth = Math.max(1, containerWidth - HORIZONTAL_GUTTER_PX);

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-6 py-6">
      {containerWidth > 0 ? (
        <Document
          file={pdfUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={(error) =>
            console.error("[signed-pdf-viewer] Document onLoadError:", error)
          }
          loading={<div className="text-muted-foreground">Loading PDF…</div>}
          error={<div className="text-red-500">Failed to load PDF</div>}
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div key={i + 1} className="shadow-lg">
              <Page
                pageNumber={i + 1}
                width={pageWidth}
                renderAnnotationLayer={false}
                renderTextLayer={false}
              />
            </div>
          ))}
        </Document>
      ) : (
        <div className="text-muted-foreground py-12">Loading PDF…</div>
      )}
    </div>
  );
}
