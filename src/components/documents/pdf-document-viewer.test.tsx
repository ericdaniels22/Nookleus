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
    Page: (props: { pageNumber: number; width?: number }) => (
      <div data-testid={`pdf-page-${props.pageNumber}`} data-width={props.width} />
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
    // Container measures 800px (stubbed above); pages render at width minus the
    // 16px horizontal gutter — mirroring the contracts viewer's fit-to-width.
    render(
      <PdfDocumentViewer src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );

    act(() => {
      pdf.resolve(2);
    });

    expect(screen.getByTestId("pdf-page-1").getAttribute("data-width")).toBe("784");
    expect(screen.getByTestId("pdf-page-2").getAttribute("data-width")).toBe("784");
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
