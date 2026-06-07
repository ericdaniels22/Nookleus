import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

// react-pdf drives pdf.js (canvas + a web worker), neither of which exists in
// jsdom — and nothing in this repo mocks it yet, so we establish the pattern
// here. The stand-in is a faithful-enough state machine: it shows the `loading`
// slot until the test resolves the document, the `error` slot if the test fails
// it, and the page `children` once loaded. `vi.hoisted` lets the hoisted
// vi.mock factory reference these capture/control objects without a
// temporal-dead-zone error.
const { documentCalls, pdf, io } = vi.hoisted(() => {
  // Reassigned by the latest mounted <Document> mock, so a retry remount wins.
  // The no-op placeholders take no args (assignable to the declared signature),
  // which keeps the typed `resolve(n)` call site honest without an unused param.
  const pdf: { resolve: (numPages: number) => void; fail: () => void } = {
    resolve: () => {},
    fail: () => {},
  };
  // Drives the scroll-spy IntersectionObserver (#466). The viewer observes each
  // page node; the stubbed observer records the callback + observed nodes here,
  // and `io.fire` synthesises entries from a { pageNumber: ratio } map so a test
  // can say "page 2 is now the most-visible" without a real layout engine.
  const io: {
    cb:
      | ((
          entries: Array<{
            target: Element;
            isIntersecting: boolean;
            intersectionRatio: number;
          }>,
        ) => void)
      | null;
    observed: Element[];
    fire: (ratios: Record<number, number>) => void;
  } = {
    cb: null,
    observed: [],
    fire: (ratios) => {
      const entries = io.observed.map((target) => {
        const pageNumber = Number(target.getAttribute("data-page-number"));
        const ratio = ratios[pageNumber] ?? 0;
        return { target, isIntersecting: ratio > 0, intersectionRatio: ratio };
      });
      io.cb?.(entries);
    },
  };
  return { documentCalls: [] as Array<Record<string, unknown>>, pdf, io };
});

vi.mock("react-pdf", async () => {
  const React = await import("react");
  return {
    Document: (props: Record<string, unknown> & { children?: unknown }) => {
      documentCalls.push(props);
      const [status, setStatus] = React.useState<"loading" | "loaded" | "error">(
        "loading",
      );
      pdf.resolve = (numPages: number) => {
        (props.onLoadSuccess as ((e: { numPages: number }) => void) | undefined)?.({
          numPages,
        });
        setStatus("loaded");
      };
      pdf.fail = () => {
        (props.onLoadError as ((e: Error) => void) | undefined)?.(
          new Error("load failed"),
        );
        setStatus("error");
      };
      if (status === "loading") return <>{props.loading as React.ReactNode}</>;
      if (status === "error") return <>{props.error as React.ReactNode}</>;
      return (
        <div data-testid="pdf-document" data-file={String(props.file)}>
          {props.children as React.ReactNode}
        </div>
      );
    },
    Page: (props: {
      pageNumber: number;
      width?: number;
      inputRef?: (el: HTMLDivElement | null) => void;
      children?: React.ReactNode;
    }) => (
      <div
        ref={props.inputRef}
        data-testid={`pdf-page-${props.pageNumber}`}
        data-page-number={props.pageNumber}
        data-width={props.width}
      >
        {props.children}
      </div>
    ),
    // Faithful to react-pdf 10's <Thumbnail>: a clickable <a> that fires
    // onItemClick({ pageIndex, pageNumber }) and wraps the page plus any
    // children. We forward an sr-only label as children, so the link picks up an
    // accessible name from its content (Page itself drops aria-label).
    Thumbnail: (props: {
      pageNumber: number;
      width?: number;
      className?: string;
      children?: React.ReactNode;
      onItemClick?: (e: { pageIndex: number; pageNumber: number }) => void;
    }) => (
      <a
        href="#"
        className={`react-pdf__Thumbnail ${props.className ?? ""}`.trim()}
        data-testid={`pdf-thumb-${props.pageNumber}`}
        onClick={(e) => {
          e.preventDefault();
          props.onItemClick?.({
            pageIndex: props.pageNumber - 1,
            pageNumber: props.pageNumber,
          });
        }}
      >
        <span
          data-testid={`pdf-thumb-page-${props.pageNumber}`}
          data-width={props.width}
        />
        {props.children}
      </a>
    ),
    pdfjs: { GlobalWorkerOptions: {} },
  };
});

vi.mock("@/lib/pdf/configure-pdfjs", () => ({ configurePdfjs: vi.fn() }));

import PdfDocumentViewer from "./pdf-document-viewer";
import { configurePdfjs } from "@/lib/pdf/configure-pdfjs";

beforeEach(() => {
  documentCalls.length = 0;
  // jsdom has no layout engine: clientWidth is always 0 and ResizeObserver is
  // undefined. The viewer measures its container to fit pages to width, so give
  // it a non-zero width and a no-op observer — otherwise its measure gate would
  // never open and no page would ever mount.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    value: 800,
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // jsdom has no IntersectionObserver either. Scroll-spy (#466) observes each
  // page node and marks the most-visible one active; the stub captures the
  // viewer's callback and observed nodes into `io` so a test can drive
  // intersection ratios with `io.fire({ page: ratio })`.
  io.cb = null;
  io.observed = [];
  globalThis.IntersectionObserver = class {
    constructor(
      cb: (
        entries: Array<{
          target: Element;
          isIntersecting: boolean;
          intersectionRatio: number;
        }>,
      ) => void,
    ) {
      io.cb = cb;
      io.observed = [];
    }
    observe(el: Element) {
      io.observed.push(el);
    }
    unobserve(el: Element) {
      io.observed = io.observed.filter((node) => node !== el);
    }
    disconnect() {
      io.observed = [];
    }
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
});

describe("PdfDocumentViewer", () => {
  it("paints the streamed /preview PDF through react-pdf's <Document file={src}>", () => {
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );

    expect(documentCalls.length).toBeGreaterThan(0);
    expect(documentCalls[0].file).toBe("/api/estimates/abc/preview");
  });

  it("disables Range/stream negotiation so Chrome cannot stall on the no-Accept-Ranges /preview byte stream", () => {
    // ADR 0013 constraint 1: /preview returns a whole-buffer 200 with no
    // Accept-Ranges, so the viewer must opt out of partial-content fetching.
    render(
      <PdfDocumentViewer src="/api/invoices/xyz/preview" title="Invoice JOB-1" />,
    );

    expect(documentCalls[0].options).toEqual({
      disableStream: true,
      disableRange: true,
    });
  });

  it("renders every page in one continuous scroll once the document reports its page count", () => {
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );

    act(() => {
      pdf.resolve(3);
    });

    expect(screen.getByTestId("pdf-page-1")).toBeDefined();
    expect(screen.getByTestId("pdf-page-2")).toBeDefined();
    expect(screen.getByTestId("pdf-page-3")).toBeDefined();
    expect(screen.queryByTestId("pdf-page-4")).toBeNull();
  });

  it("fits each page to the measured container width so the document is never cropped or tiny", () => {
    // Container measures 800px (stubbed above). #465 split the viewer into a
    // ~¼ rail + page pane, so a multi-page document's pages now render at
    // 800 - 200 rail - 16 gutter = 584px (down from the pre-rail 784px). The
    // dedicated rail test below pins the rail width itself.
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );

    act(() => {
      pdf.resolve(2);
    });

    expect(screen.getByTestId("pdf-page-1").getAttribute("data-width")).toBe("584");
    expect(screen.getByTestId("pdf-page-2").getAttribute("data-width")).toBe("584");
  });

  it("renders a thumbnail rail at ~a quarter of the width with the document pane filling the rest", () => {
    // #465: the multi-page document now splits into a slim rail (~¼) and a page
    // pane. At the 800px stubbed container, computePaneWidths gives a 200px rail,
    // leaving 800 - 200 - 16 gutter = 584px for the pages.
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );

    act(() => {
      pdf.resolve(3);
    });

    const rail = screen.getByRole("navigation", { name: /page thumbnails/i });
    expect(rail.style.width).toBe("200px");

    // One thumbnail per page, each sized to the rail minus its inner padding
    // (200px rail - 24px padding = 176px) so it never butts against the edges.
    expect(screen.getByTestId("pdf-thumb-1")).toBeDefined();
    expect(screen.getByTestId("pdf-thumb-2")).toBeDefined();
    expect(screen.getByTestId("pdf-thumb-3")).toBeDefined();
    expect(
      screen.getByTestId("pdf-thumb-page-1").getAttribute("data-width"),
    ).toBe("176");

    // Document pane fills the remaining width.
    expect(screen.getByTestId("pdf-page-1").getAttribute("data-width")).toBe("584");
  });

  it("scrolls the document pane to the matching page when its thumbnail is clicked", () => {
    // #465: clicking a thumbnail jumps the page pane to that page. The viewer
    // captures each Page's DOM node and calls scrollIntoView on the one whose
    // number matches the clicked thumbnail. (Active-page highlight + scroll-sync
    // are explicitly out of scope here — deferred to slice #4.) jsdom has no
    // layout engine, so scrollIntoView is undefined: stub it with a spy that
    // records which page node it was called on.
    const scrolledPages: Array<string | null> = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function (this: HTMLElement) {
        scrolledPages.push(this.getAttribute("data-page-number"));
      },
    });

    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(3);
    });

    act(() => {
      fireEvent.click(screen.getByTestId("pdf-thumb-2"));
    });

    expect(scrolledPages).toEqual(["2"]);
  });

  it("omits the picker rail for a single-page document — there is nothing to pick", () => {
    // #465: a one-page document has no pages to pick between, so the rail
    // collapses and the lone page reclaims the full width.
    render(
      <PdfDocumentViewer src="/api/invoices/xyz/preview" title="Invoice JOB-1" />,
    );
    act(() => {
      pdf.resolve(1);
    });

    expect(
      screen.queryByRole("navigation", { name: /page thumbnails/i }),
    ).toBeNull();
    expect(screen.queryByTestId("pdf-thumb-1")).toBeNull();
    expect(screen.getByTestId("pdf-page-1").getAttribute("data-width")).toBe("784");
  });

  it("auto-hides the rail when the container is narrower than the two-pane breakpoint", () => {
    // #465: on a phone-width container the rail would crowd out the document, so
    // it collapses below the breakpoint and the pages fill the narrow width.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      value: 500,
    });
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(3);
    });

    expect(
      screen.queryByRole("navigation", { name: /page thumbnails/i }),
    ).toBeNull();
    expect(screen.getByTestId("pdf-page-1").getAttribute("data-width")).toBe("484");
  });

  it("lets the reader hide and reopen the rail with a toggle control", () => {
    // #465: the rail is collapsible so the reader can reclaim the full width for
    // reading, then bring the picker back.
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(3);
    });

    expect(
      screen.getByRole("navigation", { name: /page thumbnails/i }),
    ).toBeDefined();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /hide thumbnails/i }));
    });
    expect(
      screen.queryByRole("navigation", { name: /page thumbnails/i }),
    ).toBeNull();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /show thumbnails/i }));
    });
    expect(
      screen.getByRole("navigation", { name: /page thumbnails/i }),
    ).toBeDefined();
  });

  it("labels each thumbnail with its page position for screen readers", () => {
    // #465: react-pdf's Page drops aria-label, so the accessible name has to
    // come from the Thumbnail's content — an sr-only "Page N of M" label. #466
    // appends ", current page" to whichever page is active (page 1 on load).
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(7);
    });

    expect(
      screen.getByRole("link", { name: "Page 1 of 7, current page" }),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "Page 3 of 7" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Page 7 of 7" })).toBeDefined();
  });

  it("gives the rail its own bounded scroll region so it scrolls independently of the pages", () => {
    // #465: a long document's rail must not stretch the whole frame — it owns a
    // height-bounded, scrollable column distinct from the page pane.
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(12);
    });

    const rail = screen.getByRole("navigation", { name: /page thumbnails/i });
    expect(rail.style.overflowY).toBe("auto");
    expect(rail.style.maxHeight).not.toBe("");
  });

  it("shows a clear loading message before the document resolves, never a blank frame", () => {
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );

    // The document has not resolved yet — the user must see a placeholder.
    expect(screen.getByText(/loading/i)).toBeDefined();
    expect(screen.queryByTestId("pdf-page-1")).toBeNull();
  });

  it("shows a friendly message and a Retry control when the document fails to load", () => {
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );

    act(() => {
      pdf.fail();
    });

    expect(screen.getByText(/we couldn.t load this document/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("re-attempts the load when Retry is clicked, recovering to the rendered document", () => {
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );

    act(() => {
      pdf.fail();
    });
    expect(screen.getByText(/we couldn.t load this document/i)).toBeDefined();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    });

    // Retry clears the error and returns to loading — a fresh fetch attempt.
    expect(screen.queryByText(/we couldn.t load this document/i)).toBeNull();
    expect(screen.getByText(/loading/i)).toBeDefined();

    // The fresh attempt can now succeed and paint the document.
    act(() => {
      pdf.resolve(1);
    });
    expect(screen.getByTestId("pdf-page-1")).toBeDefined();
  });

  it("configures the version-locked pdf.js worker on mount (ADR 0013 constraint 2)", () => {
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );

    expect(vi.mocked(configurePdfjs)).toHaveBeenCalled();
  });

  it("marks the first page as the active thumbnail once the document loads", () => {
    // #466: the picker always has exactly one active page; before the reader
    // scrolls or picks, that is page 1. Active state is exposed as aria-current
    // on the thumbnail's wrapper so it is both visible and announced.
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(3);
    });

    expect(
      screen.getByTestId("pdf-thumb-1").closest('[aria-current="page"]'),
    ).not.toBeNull();
    expect(
      screen.getByTestId("pdf-thumb-2").closest('[aria-current="page"]'),
    ).toBeNull();
    expect(
      screen.getByTestId("pdf-thumb-3").closest('[aria-current="page"]'),
    ).toBeNull();
  });

  it("announces the active page as the current page in its accessible name", () => {
    // #466: react-pdf forwards only className/onItemClick to the thumbnail's <a>,
    // so aria-current on the wrapper is never inherited by the link a keyboard /
    // screen-reader user actually focuses. The current-page state therefore has
    // to ride the link's own accessible name, so AT users hear it too — not just
    // sighted users who see the ring.
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(3);
    });

    // Page 1 is active on load: its link announces that it is current.
    expect(
      screen.getByRole("link", { name: "Page 1 of 3, current page" }),
    ).toBeDefined();
    // Non-active pages announce only their position.
    expect(screen.getByRole("link", { name: "Page 2 of 3" })).toBeDefined();
    expect(
      screen.queryByRole("link", { name: "Page 2 of 3, current page" }),
    ).toBeNull();
  });

  it("tracks the most-visible page as the reader scrolls, marking its thumbnail active", () => {
    // #466 core behavior: scroll-spy is an IntersectionObserver binding that maps
    // whichever page element is most visible in the pane to the active page. We
    // drive the observer directly with intersection ratios — no real layout — and
    // assert the active marker follows the dominant page.
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(3);
    });

    // Page 2 now dominates the viewport: it becomes the active thumbnail.
    act(() => {
      io.fire({ 1: 0.1, 2: 0.9, 3: 0 });
    });
    expect(
      screen.getByTestId("pdf-thumb-2").closest('[aria-current="page"]'),
    ).not.toBeNull();
    expect(
      screen.getByTestId("pdf-thumb-1").closest('[aria-current="page"]'),
    ).toBeNull();

    // Scrolling on so page 3 dominates moves the active marker along with it.
    act(() => {
      io.fire({ 1: 0, 2: 0.2, 3: 0.85 });
    });
    expect(
      screen.getByTestId("pdf-thumb-3").closest('[aria-current="page"]'),
    ).not.toBeNull();
    expect(
      screen.getByTestId("pdf-thumb-2").closest('[aria-current="page"]'),
    ).toBeNull();
  });

  it("breaks an equal-visibility tie toward the lower page so the marker never jitters", () => {
    // #466: when two pages straddle the fold equally, the active marker must
    // settle deterministically rather than flicker between them. The lower page
    // number wins.
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(3);
    });

    act(() => {
      io.fire({ 1: 0, 2: 0.5, 3: 0.5 });
    });

    expect(
      screen.getByTestId("pdf-thumb-2").closest('[aria-current="page"]'),
    ).not.toBeNull();
    expect(
      screen.getByTestId("pdf-thumb-3").closest('[aria-current="page"]'),
    ).toBeNull();
  });

  it("marks a clicked thumbnail active immediately, not just after the scroll settles", () => {
    // #466: a thumbnail click jumps to that page (smooth scroll) AND makes it the
    // active page right away, so the highlight tracks the reader's intent without
    // waiting for scroll-spy to catch up. jsdom has no scrollIntoView, so stub it.
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function () {},
    });
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(3);
    });

    act(() => {
      fireEvent.click(screen.getByTestId("pdf-thumb-3"));
    });

    expect(
      screen.getByTestId("pdf-thumb-3").closest('[aria-current="page"]'),
    ).not.toBeNull();
    expect(
      screen.getByTestId("pdf-thumb-1").closest('[aria-current="page"]'),
    ).toBeNull();
  });

  it("moves the active page up and down the rail with the arrow keys, scrolling the document to each", () => {
    // #466: the rail is keyboard-navigable — ArrowDown/ArrowUp step the active
    // page through the document AND scroll the pane to the page they land on
    // (criterion 4, "the document scrolls accordingly"). jsdom has no
    // scrollIntoView, so record which page node each step scrolls to.
    const scrolledPages: Array<string | null> = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function (this: HTMLElement) {
        scrolledPages.push(this.getAttribute("data-page-number"));
      },
    });
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(3);
    });

    const rail = screen.getByRole("navigation", { name: /page thumbnails/i });

    act(() => {
      fireEvent.keyDown(rail, { key: "ArrowDown" });
    });
    expect(
      screen.getByTestId("pdf-thumb-2").closest('[aria-current="page"]'),
    ).not.toBeNull();

    act(() => {
      fireEvent.keyDown(rail, { key: "ArrowDown" });
    });
    expect(
      screen.getByTestId("pdf-thumb-3").closest('[aria-current="page"]'),
    ).not.toBeNull();

    act(() => {
      fireEvent.keyDown(rail, { key: "ArrowUp" });
    });
    expect(
      screen.getByTestId("pdf-thumb-2").closest('[aria-current="page"]'),
    ).not.toBeNull();

    // Each arrow step scrolled the pane to the page it landed on.
    expect(scrolledPages).toEqual(["2", "3", "2"]);
  });

  it("moves keyboard focus onto the thumbnail it steps to without a competing scroll", () => {
    // #466: arrow-key nav must carry focus to the page it lands on, so a keyboard
    // reader is never stranded on the thumbnail they just left. The focus call
    // must opt out of the browser's instant focus-scroll (preventScroll) so it
    // doesn't fight the smooth scrollIntoView that the same keypress kicks off.
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function () {},
    });
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(3);
    });

    const rail = screen.getByRole("navigation", { name: /page thumbnails/i });
    act(() => {
      fireEvent.keyDown(rail, { key: "ArrowDown" });
    });

    expect(document.activeElement).toBe(screen.getByTestId("pdf-thumb-2"));
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    focusSpy.mockRestore();
  });
});
