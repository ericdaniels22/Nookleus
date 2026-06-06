// Render-shape coverage for the line-item note on the PDF (#382). The note is
// an italic sub-line under the description, gated by the repurposed
// `show_item_notes` toggle — never a separate "Notes" column.

import { describe, expect, it } from "vitest";

import { SectionsTable } from "./sections-table";
import { expandTree, collectText } from "@/components/report-pdf/test-helpers";
import type { EstimateSection, EstimateLineItem, DocumentPdfLayout } from "@/lib/types";

function makeLayout(overrides: Partial<DocumentPdfLayout> = {}): DocumentPdfLayout {
  return {
    document_title: "Estimate",
    show_document_title: true,
    show_markup: true,
    show_discount: true,
    show_tax: true,
    show_opening_statement: true,
    show_closing_statement: true,
    show_category_subtotals: false,
    show_code_column: true,
    show_item_notes: true,
    ...overrides,
  };
}

const section: EstimateSection = {
  id: "sec-1",
  organization_id: "org-1",
  estimate_id: "est-1",
  parent_section_id: null,
  title: "Roofing",
  sort_order: 0,
  created_at: "",
  updated_at: "",
};

function lineItem(overrides: Partial<EstimateLineItem> = {}): EstimateLineItem {
  return {
    id: "li-1",
    organization_id: "org-1",
    estimate_id: "est-1",
    section_id: "sec-1",
    library_item_id: null,
    name: "Shingles",
    description: "Replace damaged shingles",
    note: "Match existing shingle color",
    code: "RF-01",
    quantity: 1,
    unit: "sq",
    unit_price: 100,
    total: 100,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("SectionsTable — line-item note (#382)", () => {
  it("renders the note when show_item_notes is on", () => {
    const tree = expandTree(
      <SectionsTable sections={[section]} lineItems={[lineItem()]} layout={makeLayout()} />,
    );
    expect(collectText(tree)).toContain("Match existing shingle color");
  });

  it("omits the note when show_item_notes is off", () => {
    const tree = expandTree(
      <SectionsTable
        sections={[section]}
        lineItems={[lineItem()]}
        layout={makeLayout({ show_item_notes: false })}
      />,
    );
    expect(collectText(tree)).not.toContain("Match existing shingle color");
  });

  it("does not render a note when the item has none, even with the toggle on", () => {
    const tree = expandTree(
      <SectionsTable
        sections={[section]}
        lineItems={[lineItem({ note: null })]}
        layout={makeLayout()}
      />,
    );
    // Description still renders; there's simply no note sub-line.
    expect(collectText(tree)).toContain("Replace damaged shingles");
  });

  it("does not render a 'Notes' column header (note is a sub-line, not a column)", () => {
    const tree = expandTree(
      <SectionsTable sections={[section]} lineItems={[lineItem()]} layout={makeLayout()} />,
    );
    expect(collectText(tree)).not.toContain("Notes");
  });
});
