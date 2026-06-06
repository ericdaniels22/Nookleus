// Render-shape coverage for the document-title gate on the PDF masthead (#482).
// `show_document_title` hides only the title text — the logo still renders, so a
// logo-only masthead is possible. The toggle defaults on, preserving the
// historical "title always shows" look for documents with no layout.

import { describe, expect, it } from "vitest";

import { PageHeader } from "./page-header";
import {
  collectText,
  expandTree,
  findAll,
} from "@/components/report-pdf/test-helpers";

describe("PageHeader — document-title gate (#482)", () => {
  it("renders the document title when show_document_title is on", () => {
    const tree = expandTree(
      <PageHeader documentTitle="Estimate" showDocumentTitle logoUrl={null} />,
    );
    expect(collectText(tree)).toContain("Estimate");
  });

  it("omits the document title when show_document_title is off", () => {
    const tree = expandTree(
      <PageHeader documentTitle="Estimate" showDocumentTitle={false} logoUrl={null} />,
    );
    expect(collectText(tree)).not.toContain("Estimate");
  });

  it("still renders the logo when the title is hidden", () => {
    const tree = expandTree(
      <PageHeader
        documentTitle="Estimate"
        showDocumentTitle={false}
        logoUrl="https://cdn.example/logo.png"
      />,
    );
    // The title text is gone, but the masthead's logo image survives — proving
    // the gate hides the title only, not the whole header.
    expect(collectText(tree)).not.toContain("Estimate");
    expect(findAll(tree, (n) => n.type === "IMAGE")).toHaveLength(1);
  });
});
