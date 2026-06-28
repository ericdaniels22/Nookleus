import { describe, it, expect } from "vitest";
import { insertLineItemAtContainerTop, insertLineItemAfter } from "./insert-line-item";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers — terse builders for Section / Subsection / Line item trees,
// mirroring move-line-item.test.ts. Items default to a `section_id` field so we
// exercise the estimate/invoice shape; template-shape items (no `section_id`)
// get their own test.
// ─────────────────────────────────────────────────────────────────────────────

interface TestItem {
  id: string;
  sort_order: number;
  section_id?: string;
  description?: string;
}

interface TestSub {
  id: string;
  sort_order: number;
  items: TestItem[];
}

interface TestSec {
  id: string;
  sort_order: number;
  items: TestItem[];
  subsections: TestSub[];
}

function item(id: string, sectionId: string, sort_order: number, description = id): TestItem {
  return { id, section_id: sectionId, sort_order, description };
}

function sub(id: string, sort_order: number, items: TestItem[]): TestSub {
  return { id, sort_order, items };
}

function sec(
  id: string,
  sort_order: number,
  items: TestItem[],
  subsections: TestSub[] = [],
): TestSec {
  return { id, sort_order, items, subsections };
}

function ids(items: TestItem[]): string[] {
  return items.map((i) => i.id);
}

function orders(items: TestItem[]): number[] {
  return items.map((i) => i.sort_order);
}

describe("insertLineItemAtContainerTop", () => {
  // Scenario 1 (tracer) — new row lands at index 0 of a populated Section.
  it("inserts a Line item at the top of a Section's direct items", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0), item("B", "S1", 1)]),
    ];

    const next = insertLineItemAtContainerTop(tree, "S1", item("NEW", "S1", 999));

    expect(ids(next[0].items)).toEqual(["NEW", "A", "B"]);
    expect(orders(next[0].items)).toEqual([0, 1, 2]);
  });

  // Scenario 2 — new row lands at index 0 of a Subsection's items.
  it("inserts a Line item at the top of a Subsection's items", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [], [sub("Sub1", 0, [item("X", "Sub1", 0), item("Y", "Sub1", 1)])]),
    ];

    const next = insertLineItemAtContainerTop(tree, "Sub1", item("NEW", "Sub1", 999));

    expect(next[0].items).toEqual([]);
    expect(ids(next[0].subsections[0].items)).toEqual(["NEW", "X", "Y"]);
    expect(orders(next[0].subsections[0].items)).toEqual([0, 1, 2]);
  });

  // Scenario 3 — empty Section: the new row becomes the sole item at sort_order 0.
  it("inserts into an empty Section", () => {
    const tree: TestSec[] = [sec("S1", 0, [])];

    const next = insertLineItemAtContainerTop(tree, "S1", item("NEW", "S1", 999));

    expect(ids(next[0].items)).toEqual(["NEW"]);
    expect(orders(next[0].items)).toEqual([0]);
  });

  // Scenario 4 — empty Subsection: same, nested.
  it("inserts into an empty Subsection", () => {
    const tree: TestSec[] = [sec("S1", 0, [], [sub("Sub1", 0, [])])];

    const next = insertLineItemAtContainerTop(tree, "Sub1", item("NEW", "Sub1", 999));

    expect(ids(next[0].subsections[0].items)).toEqual(["NEW"]);
    expect(orders(next[0].subsections[0].items)).toEqual([0]);
  });

  // Scenario 5 — the inserted item's section_id is normalized to the container id,
  // matching the move-line-item contract (a Subsection item carries the
  // Subsection's id as its section_id).
  it("reassigns the inserted item's section_id to the container id", () => {
    const tree: TestSec[] = [sec("S1", 0, [], [sub("Sub1", 0, [item("X", "Sub1", 0)])])];

    const next = insertLineItemAtContainerTop(tree, "Sub1", item("NEW", "WRONG", 999));

    expect(next[0].subsections[0].items[0].id).toBe("NEW");
    expect(next[0].subsections[0].items[0].section_id).toBe("Sub1");
  });

  // Scenario 6 — unknown container id is a no-op (tree returned unchanged).
  it("returns the tree unchanged when the container id is not found", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0)], [sub("Sub1", 0, [item("X", "Sub1", 0)])]),
    ];

    const next = insertLineItemAtContainerTop(tree, "MISSING", item("NEW", "MISSING", 999));

    expect(ids(next[0].items)).toEqual(["A"]);
    expect(ids(next[0].subsections[0].items)).toEqual(["X"]);
  });

  // Scenario 7 — template-shape items lack a section_id; the helper must not add
  // one and must still insert by tree position.
  it("handles template-shape items that lack a section_id field", () => {
    const tree = [
      {
        id: "S1",
        sort_order: 0,
        items: [{ id: "A", sort_order: 0 }],
        subsections: [],
      },
    ];

    const next = insertLineItemAtContainerTop(tree, "S1", { id: "NEW", sort_order: 999 });

    expect(next[0].items.map((i) => i.id)).toEqual(["NEW", "A"]);
    expect(next[0].items.map((i) => i.sort_order)).toEqual([0, 1]);
    expect("section_id" in next[0].items[0]).toBe(false);
  });

  // Scenario 8 — the input tree is not mutated.
  it("does not mutate the input tree", () => {
    const original = sec("S1", 0, [item("A", "S1", 0)]);
    const tree: TestSec[] = [original];

    insertLineItemAtContainerTop(tree, "S1", item("NEW", "S1", 999));

    expect(ids(original.items)).toEqual(["A"]);
    expect(orders(original.items)).toEqual([0]);
  });
});

describe("insertLineItemAfter", () => {
  // Scenario 1 (tracer) — the new row lands directly AFTER its sibling in a
  // Section's direct items, and sort_order recompacts.
  it("inserts a Line item directly after its sibling in a Section", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0), item("B", "S1", 1), item("C", "S1", 2)]),
    ];

    const next = insertLineItemAfter(tree, "B", item("NEW", "S1", 999));

    expect(ids(next[0].items)).toEqual(["A", "B", "NEW", "C"]);
    expect(orders(next[0].items)).toEqual([0, 1, 2, 3]);
  });

  // Scenario 2 — insert after a sibling living in a Subsection's items.
  it("inserts a Line item directly after its sibling in a Subsection", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [], [sub("Sub1", 0, [item("X", "Sub1", 0), item("Y", "Sub1", 1)])]),
    ];

    const next = insertLineItemAfter(tree, "X", item("NEW", "Sub1", 999));

    expect(next[0].items).toEqual([]);
    expect(ids(next[0].subsections[0].items)).toEqual(["X", "NEW", "Y"]);
    expect(orders(next[0].subsections[0].items)).toEqual([0, 1, 2]);
  });

  // Scenario 3 — sibling is the LAST item: the copy lands at the end.
  it("appends after the sibling when the sibling is last", () => {
    const tree: TestSec[] = [sec("S1", 0, [item("A", "S1", 0), item("B", "S1", 1)])];

    const next = insertLineItemAfter(tree, "B", item("NEW", "S1", 999));

    expect(ids(next[0].items)).toEqual(["A", "B", "NEW"]);
    expect(orders(next[0].items)).toEqual([0, 1, 2]);
  });

  // Scenario 4 — the inserted item's section_id is normalized to its new
  // container, matching the move/insert-top contract.
  it("reassigns the inserted item's section_id to the sibling's container id", () => {
    const tree: TestSec[] = [sec("S1", 0, [], [sub("Sub1", 0, [item("X", "Sub1", 0)])])];

    const next = insertLineItemAfter(tree, "X", item("NEW", "WRONG", 999));

    expect(next[0].subsections[0].items[1].id).toBe("NEW");
    expect(next[0].subsections[0].items[1].section_id).toBe("Sub1");
  });

  // Scenario 5 — unknown sibling id is a no-op (tree returned unchanged).
  it("returns the tree unchanged when the sibling id is not found", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0)], [sub("Sub1", 0, [item("X", "Sub1", 0)])]),
    ];

    const next = insertLineItemAfter(tree, "MISSING", item("NEW", "S1", 999));

    expect(ids(next[0].items)).toEqual(["A"]);
    expect(ids(next[0].subsections[0].items)).toEqual(["X"]);
  });

  // Scenario 6 — template-shape items lack a section_id; the helper must not add
  // one and must still insert by tree position.
  it("handles template-shape items that lack a section_id field", () => {
    const tree = [
      {
        id: "S1",
        sort_order: 0,
        items: [{ id: "A", sort_order: 0 }, { id: "B", sort_order: 1 }],
        subsections: [],
      },
    ];

    const next = insertLineItemAfter(tree, "A", { id: "NEW", sort_order: 999 });

    expect(next[0].items.map((i) => i.id)).toEqual(["A", "NEW", "B"]);
    expect(next[0].items.map((i) => i.sort_order)).toEqual([0, 1, 2]);
    expect("section_id" in next[0].items[1]).toBe(false);
  });

  // Scenario 7 — the input tree is not mutated.
  it("does not mutate the input tree", () => {
    const original = sec("S1", 0, [item("A", "S1", 0), item("B", "S1", 1)]);
    const tree: TestSec[] = [original];

    insertLineItemAfter(tree, "A", item("NEW", "S1", 999));

    expect(ids(original.items)).toEqual(["A", "B"]);
    expect(orders(original.items)).toEqual([0, 1]);
  });
});
