import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The seam loads the heavy react-pdf island lazily (ssr:false, because react-pdf
// evaluates pdfjs-dist at import time and cannot be server-rendered). In jsdom we
// stand in a lightweight stub so this test exercises the seam's pass-through
// contract — not pdf.js — by echoing the props it receives into the DOM.
vi.mock("./pdf-document-viewer", () => ({
  default: ({ src, title }: { src: string; title: string }) => (
    <div data-testid="pdf-island" data-src={src} data-title={title} />
  ),
}));

import { PdfPreviewFrame } from "./pdf-preview-frame";

describe("PdfPreviewFrame", () => {
  it("renders the in-app document viewer island with the src and title it was given", async () => {
    render(
      <PdfPreviewFrame src="/api/estimates/abc/preview" title="Estimate WTR-1" />,
    );

    // findBy* waits out the lazy dynamic import before asserting.
    const island = await screen.findByTestId("pdf-island");
    expect(island.getAttribute("data-src")).toBe("/api/estimates/abc/preview");
    expect(island.getAttribute("data-title")).toBe("Estimate WTR-1");
  });
});
