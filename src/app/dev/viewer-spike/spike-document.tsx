"use client";

// SPIKE — THROWAWAY (issue #463). Mirrors src/components/contracts/signed-pdf-viewer.tsx
// (the proven react-pdf island), adding (1) a status readout and (2) the
// disableStream/disableRange mitigation the in-app viewer must adopt against the
// no-Range /preview byte stream. Reuses the existing worker config verbatim.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { configurePdfjs } from "@/lib/pdf/configure-pdfjs";

const HORIZONTAL_GUTTER_PX = 16;

interface Props {
  label: string;
  pdfUrl: string;
  disableRangeStream: boolean;
}

type Status =
  | { kind: "loading" }
  | { kind: "loaded"; pages: number }
  | { kind: "error"; message: string };

export default function SpikeDocument({ label, pdfUrl, disableRangeStream }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    configurePdfjs();
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // ResizeObserver fires an initial callback on observe(), so width is set
    // from the callback (async) rather than synchronously in the effect body.
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // react-pdf re-fetches whenever `options` changes identity, so it must be
  // memoized. Toggling the mitigation intentionally changes it.
  const options = useMemo(
    () => (disableRangeStream ? { disableStream: true, disableRange: true } : undefined),
    [disableRangeStream],
  );

  const pageWidth = Math.max(1, containerWidth - HORIZONTAL_GUTTER_PX);

  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 8, margin: "16px 0", overflow: "hidden" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          padding: "8px 12px",
          background: "#f6f6f6",
          fontSize: 13,
        }}
      >
        <strong>{label}</strong>
        <span>
          {status.kind === "loading" && "⏳ loading…"}
          {status.kind === "loaded" && `✅ rendered ${status.pages} page${status.pages === 1 ? "" : "s"}`}
          {status.kind === "error" && `❌ ${status.message}`}
          {"  ·  "}
          {disableRangeStream ? "range/stream OFF" : "range/stream ON (default)"}
        </span>
      </header>
      <div
        ref={containerRef}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          padding: 24,
          background: "#fafafa",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        {containerWidth > 0 && (
          <Document
            file={pdfUrl}
            options={options}
            onLoadSuccess={({ numPages }) => setStatus({ kind: "loaded", pages: numPages })}
            onLoadError={(error) => setStatus({ kind: "error", message: error?.message ?? String(error) })}
            onSourceError={(error) => setStatus({ kind: "error", message: error?.message ?? String(error) })}
            loading={<div style={{ color: "#777" }}>Loading PDF…</div>}
            error={<div style={{ color: "#c00" }}>Failed to load PDF</div>}
          >
            {status.kind === "loaded" &&
              Array.from({ length: status.pages }, (_, i) => (
                <div key={i + 1} style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.2)" }}>
                  <Page
                    pageNumber={i + 1}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                  />
                </div>
              ))}
          </Document>
        )}
      </div>
    </section>
  );
}
