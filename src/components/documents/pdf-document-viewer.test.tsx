import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

// react-pdf drives pdf.js (canvas + a web worker), neither of which exists in
// jsdom — and nothing in this repo mocks it yet, so we establish the pattern
// here. The stand-in is a faithful-enough state machine: it shows the `loading`
// slot until the test resolves the document, the `error` slot if the test fails
// it, and the page `children` once loaded. `vi.hoisted` lets the hoisted
// vi.mock factory reference these capture/control objects without a
// temporal-dead-zone error.
const { documentCalls, pdf } = vi.hoisted(() => {
  // Reassigned by the latest mounted <Document> mock, so a retry remount wins.
  // The no-op placeholders take no args (assignable to the declared signature),
  // which keeps the typed `resolve(n)` call site honest without an unused param.
  const pdf: { resolve: (numPages: number) => void; fail: () => void } = {
    resolve: () => {},
    fail: () => {},
  };
  return { documentCalls: [] as Array<Record<string, unknown>>, pdf };
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
    // come from the Thumbnail's content — an sr-only "Page N of M" label.
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );
    act(() => {
      pdf.resolve(7);
    });

    expect(screen.getByRole("link", { name: "Page 1 of 7" })).toBeDefined();
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
});
