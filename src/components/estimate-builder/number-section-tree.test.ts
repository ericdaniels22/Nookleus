import { describe, it, expect } from "vitest";
import { numberSectionTree, buildNumberIndex } from "./number-section-tree";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers — terse builders for Section / Subsection / Line item trees.
// Mirrors move-line-item.test.ts so the two pure-module tests read alike.
// ─────────────────────────────────────────────────────────────────────────────

interface TestItem {
  id: string;
  sort_order: number;
  section_id?: string;
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

function item(id: string, sectionId: string, sort_order: number): TestItem {
  return { id, section_id: sectionId, sort_order };
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

// ─────────────────────────────────────────────────────────────────────────────
// numberSectionTree
// ─────────────────────────────────────────────────────────────────────────────

describe("numberSectionTree", () => {
  // Tracer — proves the path: one Section + one direct Line item → 1, 1.1.
  it("numbers a single Section and its single direct Line item (1, 1.1)", () => {
    const tree: TestSec[] = [sec("S1", 0, [item("A", "S1", 0)])];

    expect(numberSectionTree(tree)).toEqual([
      { id: "S1", kind: "section", number: "1" },
      { id: "A", kind: "item", number: "1.1" },
    ]);
  });

  // A Subsection is numbered n.k; its items are numbered n.k.m.
  it("numbers a Subsection (n.k) and its items (n.k.m)", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [], [sub("Sub1", 0, [item("X", "Sub1", 0), item("Y", "Sub1", 1)])]),
    ];

    expect(numberSectionTree(tree)).toEqual([
      { id: "S1", kind: "section", number: "1" },
      { id: "Sub1", kind: "subsection", number: "1.1" },
      { id: "X", kind: "item", number: "1.1.1" },
      { id: "Y", kind: "item", number: "1.1.2" },
    ]);
  });

  // Interleave decision (#568): within a Section that has BOTH subsections and
  // loose direct items, the shared second-level counter runs subsections first
  // (2.1, 2.2) then loose items (2.3, 2.4) — matching the on-screen render order.
  it("shares the second-level counter: subsections first (2.1, 2.2), then loose items (2.3, 2.4)", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("Intro", "S1", 0)]),
      sec(
        "S2",
        1,
        [item("Permit", "S2", 0), item("Dumpster", "S2", 1)],
        [
          sub("Master", 0, [item("Tile", "Master", 0), item("Vanity", "Master", 1)]),
          sub("Guest", 1, [item("GuestTile", "Guest", 0)]),
        ],
      ),
    ];

    expect(numberSectionTree(tree)).toEqual([
      { id: "S1", kind: "section", number: "1" },
      { id: "Intro", kind: "item", number: "1.1" },
      { id: "S2", kind: "section", number: "2" },
      { id: "Master", kind: "subsection", number: "2.1" },
      { id: "Tile", kind: "item", number: "2.1.1" },
      { id: "Vanity", kind: "item", number: "2.1.2" },
      { id: "Guest", kind: "subsection", number: "2.2" },
      { id: "GuestTile", kind: "item", number: "2.2.1" },
      { id: "Permit", kind: "item", number: "2.3" },
      { id: "Dumpster", kind: "item", number: "2.4" },
    ]);
  });

  // Numbers come from POSITION after sorting by sort_order — not the raw
  // sort_order values — so gaps and out-of-order input still yield contiguous
  // 1-based numbering at every level.
  it("derives contiguous numbers from sorted position despite gappy / out-of-order sort_order", () => {
    const tree: TestSec[] = [
      sec("S2", 30, [item("B", "S2", 5), item("A", "S2", 2)]),
      sec("S1", 10, [item("C", "S1", 99)]),
    ];

    expect(numberSectionTree(tree)).toEqual([
      { id: "S1", kind: "section", number: "1" },
      { id: "C", kind: "item", number: "1.1" },
      { id: "S2", kind: "section", number: "2" },
      { id: "A", kind: "item", number: "2.1" },
      { id: "B", kind: "item", number: "2.2" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildNumberIndex — id → derived number, the read-model the builder renders.
// ─────────────────────────────────────────────────────────────────────────────

describe("buildNumberIndex", () => {
  it("maps each Section / Subsection / Line item id to its derived number", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0)], [sub("Sub1", 0, [item("X", "Sub1", 0)])]),
    ];

    const index = buildNumberIndex(tree);

    expect(index.get("S1")).toBe("1");
    expect(index.get("Sub1")).toBe("1.1");
    expect(index.get("X")).toBe("1.1.1");
    expect(index.get("A")).toBe("1.2"); // loose item numbered after the subsection
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recompute — the projection re-derives from scratch over the mutated tree, so
// add / remove / drag-reorder shift numbers with no stored state to update.
// ─────────────────────────────────────────────────────────────────────────────

describe("recompute over the mutated tree", () => {
  it("renumbers after a Line item is added", () => {
    const before: TestSec[] = [sec("S1", 0, [item("A", "S1", 0), item("B", "S1", 1)])];
    expect(buildNumberIndex(before).get("B")).toBe("1.2");

    const after: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0), item("B", "S1", 1), item("C", "S1", 2)]),
    ];
    const idx = buildNumberIndex(after);
    expect(idx.get("A")).toBe("1.1");
    expect(idx.get("B")).toBe("1.2");
    expect(idx.get("C")).toBe("1.3");
  });

  it("renumbers the trailing items after one is removed", () => {
    // B removed from [A@0, B@1, C@2]; remaining sort_order is gappy (0, 2).
    const after: TestSec[] = [sec("S1", 0, [item("A", "S1", 0), item("C", "S1", 2)])];
    const idx = buildNumberIndex(after);
    expect(idx.get("A")).toBe("1.1");
    expect(idx.get("C")).toBe("1.2"); // was 1.3 before the removal
    expect(idx.has("B")).toBe(false);
  });

  it("renumbers after a drag-reorder swaps sort_order", () => {
    // Drag put B ahead of A: B@0, A@1.
    const after: TestSec[] = [sec("S1", 0, [item("A", "S1", 1), item("B", "S1", 0)])];
    const idx = buildNumberIndex(after);
    expect(idx.get("B")).toBe("1.1");
    expect(idx.get("A")).toBe("1.2");
  });

  it("renumbers a Line item dragged from a Section's loose items into a Subsection", () => {
    // Before: A is a loose item (1.2, after subsection Sub1). After: A moved into
    // Sub1 → it becomes a subsection item (1.1.1) and the loose slot disappears.
    const after: TestSec[] = [
      sec("S1", 0, [], [sub("Sub1", 0, [item("X", "Sub1", 0), item("A", "Sub1", 1)])]),
    ];
    const idx = buildNumberIndex(after);
    expect(idx.get("Sub1")).toBe("1.1");
    expect(idx.get("X")).toBe("1.1.1");
    expect(idx.get("A")).toBe("1.1.2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("numberSectionTree — edges", () => {
  it("emits only the container row for empty Sections and Subsections", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [], [sub("Sub1", 0, [])]),
      sec("S2", 1, []),
    ];

    expect(numberSectionTree(tree)).toEqual([
      { id: "S1", kind: "section", number: "1" },
      { id: "Sub1", kind: "subsection", number: "1.1" },
      { id: "S2", kind: "section", number: "2" },
    ]);
  });

  it("returns an empty list for an empty tree", () => {
    expect(numberSectionTree([])).toEqual([]);
    expect(buildNumberIndex([]).size).toBe(0);
  });
});
