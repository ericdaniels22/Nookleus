import { describe, it, expect } from "vitest";
import { duplicateLineItem } from "./duplicate-line-item";

// A representative estimate-shape line item (every field populated) so the clone
// can be checked field-by-field. Equipment rows get their own scenario.
function standardItem() {
  return {
    id: "li-1",
    organization_id: "org-1",
    estimate_id: "est-1",
    section_id: "sec-1",
    library_item_id: "lib-1",
    name: "Excavator",
    description: "Cat 320",
    note: "bring fuel",
    code: "EXC-320",
    quantity: 6,
    unit: "day",
    unit_price: 100,
    total: 600,
    pricing_mode: "standard" as const,
    pieces: null as number | null,
    days: null as number | null,
    sort_order: 3,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  };
}

describe("duplicateLineItem", () => {
  // Scenario 1 (tracer) — the clone carries every editable field, with a fresh id.
  it("clones every field with a fresh id", () => {
    const original = standardItem();

    const copy = duplicateLineItem(original);

    expect(copy.id).toBeTruthy();
    expect(copy.id).not.toBe(original.id);

    expect(copy.name).toBe("Excavator");
    expect(copy.code).toBe("EXC-320");
    expect(copy.description).toBe("Cat 320");
    expect(copy.note).toBe("bring fuel");
    expect(copy.quantity).toBe(6);
    expect(copy.unit).toBe("day");
    expect(copy.unit_price).toBe(100);
    expect(copy.total).toBe(600);
    expect(copy.section_id).toBe("sec-1");
    expect(copy.library_item_id).toBe("lib-1");
  });

  // Scenario 2 — server identity is dropped: created_at / updated_at are gone so
  // the copy can't masquerade as the original's persisted row.
  it("drops the original's server timestamps", () => {
    const copy = duplicateLineItem(standardItem());

    expect("created_at" in copy).toBe(false);
    expect("updated_at" in copy).toBe(false);
  });

  // Scenario 3 — an equipment row carries its pieces / days / Pieces × Days mode.
  it("carries an equipment row's pieces, days, and pricing mode", () => {
    const equipment = {
      ...standardItem(),
      pricing_mode: "pieces_days" as const,
      pieces: 3,
      days: 2,
      quantity: 6, // pieces × days
      note: "3 pieces × 2 days",
    };

    const copy = duplicateLineItem(equipment);

    expect(copy.pricing_mode).toBe("pieces_days");
    expect(copy.pieces).toBe(3);
    expect(copy.days).toBe(2);
    expect(copy.quantity).toBe(6);
    expect(copy.note).toBe("3 pieces × 2 days");
  });

  // Scenario 4 — the original is not mutated (no shared references, id untouched).
  it("does not mutate the original", () => {
    const original = standardItem();

    duplicateLineItem(original);

    expect(original.id).toBe("li-1");
    expect(original.created_at).toBe("2026-01-01T00:00:00Z");
  });

  // Scenario 5 — each call produces a distinct fresh id (no collisions).
  it("produces a distinct id on each call", () => {
    const original = standardItem();

    const a = duplicateLineItem(original);
    const b = duplicateLineItem(original);

    expect(a.id).not.toBe(b.id);
  });
});
