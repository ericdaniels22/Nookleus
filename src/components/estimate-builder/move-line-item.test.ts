import { describe, it, expect } from "vitest";
import {
  moveLineItemAcrossContainers,
  resolveLineItemDropTarget,
} from "./move-line-item";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers — terse builders for Section / Subsection / Line item trees.
// Items default to a `section_id` field so we exercise the estimate/invoice
// shape; template-shape items (no `section_id`) get their own test.
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

// ─────────────────────────────────────────────────────────────────────────────
// moveLineItemAcrossContainers
// ─────────────────────────────────────────────────────────────────────────────

describe("moveLineItemAcrossContainers", () => {
  // Scenario 1 — same-container reorder (top of list → middle).
  it("reorders a Line item within its own Section", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0), item("B", "S1", 1), item("C", "S1", 2)]),
    ];

    const result = moveLineItemAcrossContainers(tree, "A", "S1", "C");

    expect(result).not.toBeNull();
    expect(ids(result!.sections[0].items)).toEqual(["B", "C", "A"]);
    expect(orders(result!.sections[0].items)).toEqual([0, 1, 2]);
  });

  // Scenario 2 — Subsection → its parent Section's direct Line items.
  it("promotes a Line item from a Subsection to its parent Section", () => {
    const tree: TestSec[] = [
      sec(
        "S1",
        0,
        [item("A", "S1", 0)],
        [sub("Sub1", 0, [item("X", "Sub1", 0), item("Y", "Sub1", 1)])],
      ),
    ];

    // Drop X onto Section S1 chrome (no overItemId) → append to S1 items.
    const result = moveLineItemAcrossContainers(tree, "X", "S1", null);

    expect(result).not.toBeNull();
    const s1 = result!.sections[0];
    expect(ids(s1.items)).toEqual(["A", "X"]);
    expect(orders(s1.items)).toEqual([0, 1]);
    expect(s1.items[1].section_id).toBe("S1");
    expect(ids(s1.subsections[0].items)).toEqual(["Y"]);
    expect(orders(s1.subsections[0].items)).toEqual([0]);
  });

  // Scenario 3 — Subsection → sibling Subsection under same parent.
  it("moves a Line item between two sibling Subsections", () => {
    const tree: TestSec[] = [
      sec(
        "S1",
        0,
        [],
        [
          sub("Sub1", 0, [item("X", "Sub1", 0), item("Y", "Sub1", 1)]),
          sub("Sub2", 1, [item("Z", "Sub2", 0)]),
        ],
      ),
    ];

    // Drop X onto Z → insert at Z's index in Sub2.
    const result = moveLineItemAcrossContainers(tree, "X", "Sub2", "Z");

    expect(result).not.toBeNull();
    const [sub1, sub2] = result!.sections[0].subsections;
    expect(ids(sub1.items)).toEqual(["Y"]);
    expect(orders(sub1.items)).toEqual([0]);
    expect(ids(sub2.items)).toEqual(["X", "Z"]);
    expect(orders(sub2.items)).toEqual([0, 1]);
    expect(sub2.items[0].section_id).toBe("Sub2");
  });

  // Scenario 4 — Subsection → Subsection under a different parent Section.
  it("moves a Line item between Subsections under different parent Sections", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [], [sub("Sub1", 0, [item("X", "Sub1", 0)])]),
      sec("S2", 1, [], [sub("Sub2", 0, [item("Y", "Sub2", 0)])]),
    ];

    const result = moveLineItemAcrossContainers(tree, "X", "Sub2", null);

    expect(result).not.toBeNull();
    expect(result!.sections[0].subsections[0].items).toEqual([]);
    const sub2 = result!.sections[1].subsections[0];
    expect(ids(sub2.items)).toEqual(["Y", "X"]);
    expect(orders(sub2.items)).toEqual([0, 1]);
    expect(sub2.items[1].section_id).toBe("Sub2");
  });

  // Scenario 5 — Section direct items → different Section's direct items.
  it("moves a Line item between two Sections' direct items lists", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0), item("B", "S1", 1)]),
      sec("S2", 1, [item("C", "S2", 0)]),
    ];

    // Drop A onto C → insert at C's index in S2.
    const result = moveLineItemAcrossContainers(tree, "A", "S2", "C");

    expect(result).not.toBeNull();
    expect(ids(result!.sections[0].items)).toEqual(["B"]);
    expect(orders(result!.sections[0].items)).toEqual([0]);
    expect(ids(result!.sections[1].items)).toEqual(["A", "C"]);
    expect(orders(result!.sections[1].items)).toEqual([0, 1]);
    expect(result!.sections[1].items[0].section_id).toBe("S2");
  });

  // Scenario 6 — Section direct items → a Subsection.
  it("moves a Line item from a Section into a Subsection", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0), item("B", "S1", 1)], [sub("Sub1", 0, [])]),
    ];

    const result = moveLineItemAcrossContainers(tree, "A", "Sub1", null);

    expect(result).not.toBeNull();
    const s1 = result!.sections[0];
    expect(ids(s1.items)).toEqual(["B"]);
    expect(orders(s1.items)).toEqual([0]);
    expect(ids(s1.subsections[0].items)).toEqual(["A"]);
    expect(orders(s1.subsections[0].items)).toEqual([0]);
    expect(s1.subsections[0].items[0].section_id).toBe("Sub1");
  });

  // Scenario 7 — drop on an otherwise-empty destination.
  it("accepts a drop on an empty destination", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0)], [sub("Sub1", 0, [])]),
    ];

    const result = moveLineItemAcrossContainers(tree, "A", "Sub1", null);

    expect(result).not.toBeNull();
    expect(result!.sections[0].items).toEqual([]);
    expect(ids(result!.sections[0].subsections[0].items)).toEqual(["A"]);
    expect(orders(result!.sections[0].subsections[0].items)).toEqual([0]);
  });

  // Scenario 8 — drop on self (over-item id equals active id in same container).
  it("returns null when an item is dropped on itself", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0), item("B", "S1", 1)]),
    ];

    const result = moveLineItemAcrossContainers(tree, "A", "S1", "A");

    expect(result).toBeNull();
  });

  // Scenario 9 — source container renumbered to contiguous 0..N-1.
  it("recompacts the source container's sort_order to 0..N-1", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [
        item("A", "S1", 0),
        item("B", "S1", 1),
        item("C", "S1", 2),
        item("D", "S1", 3),
      ]),
      sec("S2", 1, []),
    ];

    // Move B (middle) out of S1 into S2.
    const result = moveLineItemAcrossContainers(tree, "B", "S2", null);

    expect(result).not.toBeNull();
    expect(ids(result!.sections[0].items)).toEqual(["A", "C", "D"]);
    expect(orders(result!.sections[0].items)).toEqual([0, 1, 2]);
  });

  // Scenario 10 — destination container renumbered to contiguous 0..N including inserted item.
  it("recompacts the destination container's sort_order to include the inserted item", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0)]),
      sec("S2", 1, [item("X", "S2", 0), item("Y", "S2", 1)]),
    ];

    // Insert A in front of Y (at Y's index = 1).
    const result = moveLineItemAcrossContainers(tree, "A", "S2", "Y");

    expect(result).not.toBeNull();
    expect(ids(result!.sections[1].items)).toEqual(["X", "A", "Y"]);
    expect(orders(result!.sections[1].items)).toEqual([0, 1, 2]);
  });

  // Scenario 11 — moved item's section_id equals destination container id.
  it("reassigns the moved Line item's section_id to the destination container id", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0)], [sub("Sub1", 0, [])]),
    ];

    const result = moveLineItemAcrossContainers(tree, "A", "Sub1", null);

    expect(result).not.toBeNull();
    const moved = result!.sections[0].subsections[0].items[0];
    expect(moved.id).toBe("A");
    expect(moved.section_id).toBe("Sub1");
  });

  // Scenario 12 — invalid input.
  it("returns null when the active item id is not found", () => {
    const tree: TestSec[] = [sec("S1", 0, [item("A", "S1", 0)])];
    expect(moveLineItemAcrossContainers(tree, "missing", "S1", null)).toBeNull();
  });

  it("returns null when the destination container id is not found", () => {
    const tree: TestSec[] = [sec("S1", 0, [item("A", "S1", 0)])];
    expect(moveLineItemAcrossContainers(tree, "A", "S-missing", null)).toBeNull();
  });

  // Bonus — append-to-end on chrome drop within same container is a real move.
  it("moves an item to the end of its container when dropped on chrome", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0), item("B", "S1", 1), item("C", "S1", 2)]),
    ];

    const result = moveLineItemAcrossContainers(tree, "A", "S1", null);

    expect(result).not.toBeNull();
    expect(ids(result!.sections[0].items)).toEqual(["B", "C", "A"]);
    expect(orders(result!.sections[0].items)).toEqual([0, 1, 2]);
  });

  // affectedItems contract — includes source + destination items with new sort_order.
  it("returns affectedItems covering both source and destination", () => {
    const tree: TestSec[] = [
      sec("S1", 0, [item("A", "S1", 0), item("B", "S1", 1)]),
      sec("S2", 1, [item("C", "S2", 0)]),
    ];

    const result = moveLineItemAcrossContainers(tree, "B", "S2", null);

    expect(result).not.toBeNull();
    const byId = new Map(result!.affectedItems.map((a) => [a.id, a]));
    // Source S1 now has [A@0]
    expect(byId.get("A")).toEqual({ id: "A", section_id: "S1", sort_order: 0 });
    // Destination S2 now has [C@0, B@1]
    expect(byId.get("C")).toEqual({ id: "C", section_id: "S2", sort_order: 0 });
    expect(byId.get("B")).toEqual({ id: "B", section_id: "S2", sort_order: 1 });
  });

  // Template items lack `section_id` on their wire shape — the helper must not
  // crash and must still reorder by tree position.
  it("handles template-shape items that lack a section_id field", () => {
    const tree = [
      {
        id: "S1",
        sort_order: 0,
        items: [
          { id: "A", sort_order: 0 },
          { id: "B", sort_order: 1 },
        ],
        subsections: [
          {
            id: "Sub1",
            sort_order: 0,
            items: [{ id: "X", sort_order: 0 }],
          },
        ],
      },
    ];

    const result = moveLineItemAcrossContainers(tree, "X", "S1", null);

    expect(result).not.toBeNull();
    expect(result!.sections[0].items.map((i) => i.id)).toEqual(["A", "B", "X"]);
    expect(result!.sections[0].subsections[0].items).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveLineItemDropTarget
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveLineItemDropTarget", () => {
  it("resolves over a Line item to {destinationContainerId, overItemId}", () => {
    const over = {
      id: "ITEM_X",
      data: { current: { type: "line-item", parentSectionId: "Sub1" } },
    };
    expect(resolveLineItemDropTarget(over)).toEqual({
      destinationContainerId: "Sub1",
      overItemId: "ITEM_X",
    });
  });

  it("resolves over a Section to {destinationContainerId}", () => {
    const over = { id: "S1", data: { current: { type: "section" } } };
    expect(resolveLineItemDropTarget(over)).toEqual({
      destinationContainerId: "S1",
    });
  });

  it("resolves over a Subsection to {destinationContainerId}", () => {
    const over = {
      id: "Sub1",
      data: { current: { type: "subsection", parentSectionId: "S1" } },
    };
    expect(resolveLineItemDropTarget(over)).toEqual({
      destinationContainerId: "Sub1",
    });
  });

  it("returns null when over has no recognizable type", () => {
    expect(resolveLineItemDropTarget(null)).toBeNull();
    expect(resolveLineItemDropTarget({ id: "Z", data: { current: null } })).toBeNull();
    expect(
      resolveLineItemDropTarget({ id: "Z", data: { current: { type: "other" } } }),
    ).toBeNull();
  });
});
