"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Document, Page, Thumbnail } from "react-pdf";
import { configurePdfjs } from "@/lib/pdf/configure-pdfjs";
import { computePaneWidths } from "@/lib/pdf/compute-pane-widths";

// ADR 0013 constraint 1: the /preview routes stream a whole-buffer 200 with no
// Accept-Ranges, so the viewer disables Range/stream negotiation — otherwise
// Chrome can stall on partial-content fetching. Hoisted to a stable reference
// so react-pdf does not re-fetch the document on every render.
const DOCUMENT_OPTIONS = { disableStream: true, disableRange: true } as const;

// Inner padding inside the rail, subtracted from the rail width so the
// thumbnail itself never butts against the rail's edges.
const RAIL_PADDING_PX = 24;

// Below this container width the rail auto-hides (phone / narrow). Shared with
// computePaneWidths so the collapse math and the toggle's visibility agree on
// the same breakpoint.
const RAIL_COLLAPSE_BELOW_PX = 640;

interface PdfDocumentViewerProps {
  src: string;
  title: string;
}

export default function PdfDocumentViewer({ src }: PdfDocumentViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Each rendered Page registers its DOM node here keyed by page number, so a
  // thumbnail click can scroll straight to it (react-pdf's Page drops refs
  // through inputRef, not a plain ref).
  const pageNodes = useRef(new Map<number, HTMLDivElement>());
  const [containerWidth, setContainerWidth] = useState(0);
  // Reader's manual collapse of the rail (defaults open). The rail also hides
  // for single-page docs and narrow containers regardless of this flag.
  const [railOpen, setRailOpen] = useState(true);
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

  // #465: the viewer splits into a slim page-picker rail (~¼) and a page pane
  // that fills the rest. The rail collapses when the reader closes it, for a
  // single-page document (nothing to pick), or below the narrow breakpoint.
  const isMultiPage = numPages > 1;
  const { railWidth, pageWidth } = computePaneWidths(containerWidth, {
    collapseBelow: RAIL_COLLAPSE_BELOW_PX,
    collapsed: !railOpen || !isMultiPage,
  });
  const thumbnailWidth = Math.max(1, railWidth - RAIL_PADDING_PX);
  // The toggle only makes sense when the container is wide enough to host a rail
  // and there is more than one page to pick between.
  const canHostRail =
    isMultiPage && containerWidth >= RAIL_COLLAPSE_BELOW_PX;

  const scrollToPage = (pageNumber: number) => {
    pageNodes.current
      .get(pageNumber)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div ref={containerRef} className="flex w-full flex-col gap-3 py-6">
      {canHostRail && (
        <div className="flex justify-end px-2">
          <button
            type="button"
            aria-expanded={railOpen}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={() => setRailOpen((open) => !open)}
          >
            {railOpen ? "Hide thumbnails" : "Show thumbnails"}
          </button>
        </div>
      )}
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
        <div className="flex w-full gap-4">
          {railWidth > 0 && (
            <nav
              aria-label="Page thumbnails"
              style={{
                width: `${railWidth}px`,
                maxHeight: "80vh",
                overflowY: "auto",
              }}
              className="sticky top-0 flex shrink-0 flex-col items-center gap-3 px-2"
            >
              {Array.from({ length: numPages }, (_, i) => (
                <Thumbnail
                  key={i + 1}
                  pageNumber={i + 1}
                  width={thumbnailWidth}
                  className="rounded border border-border"
                  onItemClick={({ pageNumber }) => scrollToPage(pageNumber)}
                >
                  <span className="sr-only">{`Page ${i + 1} of ${numPages}`}</span>
                </Thumbnail>
              ))}
            </nav>
          )}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-6">
            {Array.from({ length: numPages }, (_, i) => (
              <Page
                key={i + 1}
                pageNumber={i + 1}
                width={pageWidth}
                inputRef={(el) => {
                  if (el) pageNodes.current.set(i + 1, el);
                  else pageNodes.current.delete(i + 1);
                }}
                renderAnnotationLayer={false}
                renderTextLayer={false}
              />
            ))}
          </div>
        </div>
      </Document>
    </div>
  );
}
