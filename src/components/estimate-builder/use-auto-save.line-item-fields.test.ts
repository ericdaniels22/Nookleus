// Guards the per-line-item auto-save field allowlist (#382). pickLineItemFields
// decides BOTH what counts as a change (the diff) and what reaches the line-item
// PUT body. A field missing here silently never persists — so the note must be
// in the picked subset for inline note edits to save.

import { describe, it, expect } from "vitest";

import { pickLineItemFields } from "./use-auto-save";

describe("pickLineItemFields — note (#382)", () => {
  it("includes the note in the saved subset", () => {
    const picked = pickLineItemFields({
      id: "li-1",
      description: "Replace shingles",
      note: "Match existing color",
      code: null,
      quantity: 1,
      unit: "sq",
      unit_price: 100,
      section_id: "sec-1",
      sort_order: 0,
    });
    expect(picked).toHaveProperty("note", "Match existing color");
  });
});

describe("pickLineItemFields — equipment pricing (#682)", () => {
  it("includes pricing_mode, pieces, and days so equipment edits persist", () => {
    const picked = pickLineItemFields({
      id: "li-1",
      description: "Air mover rental",
      note: "3 units for 10 days",
      code: null,
      quantity: 30,
      unit: null,
      unit_price: 100,
      section_id: "sec-1",
      sort_order: 0,
      pricing_mode: "pieces_days",
      pieces: 3,
      days: 10,
    });
    expect(picked).toHaveProperty("pricing_mode", "pieces_days");
    expect(picked).toHaveProperty("pieces", 3);
    expect(picked).toHaveProperty("days", 10);
  });
});
