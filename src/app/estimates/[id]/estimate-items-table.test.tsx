import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ItemsTable } from "./estimate-items-table";
import type { EstimateLineItem } from "@/lib/types";

function item(overrides: Partial<EstimateLineItem> = {}): EstimateLineItem {
  return {
    id: "li-1",
    organization_id: "org-1",
    estimate_id: "est-1",
    section_id: "sec-1",
    library_item_id: null,
    name: null,
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

describe("estimate read view ItemsTable — note (#382)", () => {
  it("renders the note as a distinct line under the description", () => {
    render(<ItemsTable items={[item()]} />);
    expect(screen.getByText("Replace damaged shingles")).toBeTruthy();
    expect(screen.getByText("Match existing shingle color")).toBeTruthy();
  });

  it("renders no note line when the item has none", () => {
    render(<ItemsTable items={[item({ note: null })]} />);
    expect(screen.queryByText("Match existing shingle color")).toBeNull();
  });
});
