import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { InvoiceItemsTable } from "./invoice-items-table";
import type { InvoiceLineItem, InvoiceWithContents } from "@/lib/types";

function lineItem(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return {
    id: "li-1",
    organization_id: "org-1",
    invoice_id: "inv-1",
    section_id: "sec-1",
    library_item_id: null,
    name: null,
    description: "Replace damaged shingles",
    note: "Match existing shingle color",
    code: null,
    quantity: 1,
    unit: "sq",
    unit_price: 100,
    amount: 100,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

type Section = InvoiceWithContents["sections"][number];

function section(overrides: Partial<Section> = {}): Section {
  return {
    id: "sec-1",
    organization_id: "org-1",
    invoice_id: "inv-1",
    parent_section_id: null,
    title: "Roofing",
    sort_order: 0,
    created_at: "",
    updated_at: "",
    items: [lineItem()],
    subsections: [],
    ...overrides,
  } as Section;
}

describe("invoice read view InvoiceItemsTable — note (#382)", () => {
  it("renders a direct item's note as a distinct line", () => {
    render(<InvoiceItemsTable section={section()} />);
    expect(screen.getByText("Replace damaged shingles")).toBeTruthy();
    expect(screen.getByText("Match existing shingle color")).toBeTruthy();
  });

  it("renders a subsection item's note too", () => {
    const sec = section({
      items: [],
      subsections: [
        {
          id: "sub-1",
          organization_id: "org-1",
          invoice_id: "inv-1",
          parent_section_id: "sec-1",
          title: "Flashing",
          sort_order: 0,
          created_at: "",
          updated_at: "",
          items: [lineItem({ id: "li-2", description: "Drip edge", note: "Aluminum, brown" })],
        },
      ],
    } as Partial<Section>);

    render(<InvoiceItemsTable section={sec} />);
    expect(screen.getByText("Aluminum, brown")).toBeTruthy();
  });

  it("renders no note line when the item has none", () => {
    render(<InvoiceItemsTable section={section({ items: [lineItem({ note: null })] })} />);
    expect(screen.queryByText("Match existing shingle color")).toBeNull();
  });
});
