"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { Document, Page, Thumbnail } from "react-pdf";
import { configurePdfjs } from "@/lib/pdf/configure-pdfjs";
import { computePaneWidths } from "@/lib/pdf/compute-pane-widths";
import {
  initialPagePickerState,
  pagePickerReducer,
  type PagePickerAction,
} from "@/lib/pdf/page-picker-reducer";

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
  // The page-picker reducer is the single source of truth for which page is
  // active. Scroll-spy, thumbnail clicks, and keyboard nav all dispatch into it,
  // so they can never disagree (#466). numPages also lives here so a Retry that
  // reloads a shorter document re-clamps the active page in one place.
  const [{ numPages, activePage }, dispatch] = useReducer(
    pagePickerReducer,
    initialPagePickerState,
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The thumbnail rail, so keyboard nav can move focus to the newly active
  // thumbnail (its anchors carry the react-pdf__Thumbnail class).
  const railRef = useRef<HTMLElement | null>(null);
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

  // Scroll-spy (#466): watch every page node and keep the active page pinned to
  // whichever one is most visible in the pane, so the rail's highlight tracks
  // the reader's scroll position. We reverse-map each observed node back to its
  // page via data-page-number, hold the latest visible ratio per page, and
  // dispatch the page with the largest one (ties favour the lower page so the
  // marker never jitters between two equally-visible pages). Keyed on numPages
  // so the observer re-binds to the freshly mounted page nodes after a (re)load.
  useEffect(() => {
    if (numPages < 1) return;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNumber = Number(
            entry.target.getAttribute("data-page-number"),
          );
          if (!pageNumber) continue;
          ratios.set(
            pageNumber,
            entry.isIntersecting ? entry.intersectionRatio : 0,
          );
        }
        let best = 0;
        let bestRatio = 0;
        for (const [pageNumber, ratio] of ratios) {
          if (ratio > bestRatio) {
            best = pageNumber;
            bestRatio = ratio;
          }
        }
        if (best > 0) dispatch({ type: "setActivePage", page: best });
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const node of pageNodes.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [numPages]);

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

  // A deliberate jump to a page (thumbnail click, keyboard nav): mark it active
  // straight away so the highlight tracks intent, then scroll it into view.
  // Scroll-spy will re-confirm the same page once the smooth scroll settles, so
  // the two paths agree rather than fight.
  const goToPage = (pageNumber: number) => {
    dispatch({ type: "setActivePage", page: pageNumber });
    scrollToPage(pageNumber);
  };

  // Move keyboard focus to a thumbnail's anchor so arrow-key nav lands the
  // reader on the page they stepped to (anchors carry react-pdf__Thumbnail).
  // preventScroll: the same keypress already runs a smooth scrollIntoView on the
  // page; letting .focus() also scroll its ancestors (instantly) would yank the
  // pane mid-animation, so we leave all scrolling to scrollToPage.
  const focusThumbnail = (pageNumber: number) => {
    railRef.current
      ?.querySelectorAll<HTMLElement>("a.react-pdf__Thumbnail")
      [pageNumber - 1]?.focus({ preventScroll: true });
  };

  // Arrow-key navigation within the rail. We run the same pure reducer the rest
  // of the picker uses to predict where the move lands (so clamping at the first
  // and last page is defined in exactly one place), then dispatch it and bring
  // that page + its thumbnail into view/focus.
  const onRailKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    let action: PagePickerAction | null = null;
    if (e.key === "ArrowDown") action = { type: "next" };
    else if (e.key === "ArrowUp") action = { type: "prev" };
    if (!action) return;
    e.preventDefault();
    const target = pagePickerReducer({ numPages, activePage }, action).activePage;
    dispatch(action);
    scrollToPage(target);
    focusThumbnail(target);
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
        onLoadSuccess={({ numPages }) =>
          dispatch({ type: "setNumPages", numPages })
        }
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
              ref={railRef}
              aria-label="Page thumbnails"
              onKeyDown={onRailKeyDown}
              style={{
                width: `${railWidth}px`,
                maxHeight: "80vh",
                overflowY: "auto",
              }}
              className="sticky top-0 flex shrink-0 flex-col items-center gap-3 px-2"
            >
              {Array.from({ length: numPages }, (_, i) => {
                const pageNumber = i + 1;
                const isActive = pageNumber === activePage;
                return (
                  // The visible active ring rides a wrapper, since react-pdf
                  // forwards only className/onItemClick to its <a>. aria-current
                  // on a generic wrapper is not announced on the link a keyboard /
                  // SR user focuses, so the "current page" state is also folded
                  // into the link's own accessible name (its sr-only label) — that
                  // is what AT actually reads when focus lands on the thumbnail.
                  <div
                    key={pageNumber}
                    aria-current={isActive ? "page" : undefined}
                    className={`rounded ${
                      isActive ? "ring-2 ring-primary ring-offset-2" : ""
                    }`.trim()}
                  >
                    <Thumbnail
                      pageNumber={pageNumber}
                      width={thumbnailWidth}
                      className="rounded border border-border"
                      onItemClick={({ pageNumber }) => goToPage(pageNumber)}
                    >
                      <span className="sr-only">
                        {`Page ${pageNumber} of ${numPages}${
                          isActive ? ", current page" : ""
                        }`}
                      </span>
                    </Thumbnail>
                  </div>
                );
              })}
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
