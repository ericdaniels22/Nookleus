// Pure positional numbering for the Estimate / Invoice / Template section tree.
//
// Isolated from React so it can be unit tested in plain Node and reused across
// builder modes. It is a *read-model projection*: numbers are derived purely
// from each row's position (after sorting by `sort_order`) and its parent
// linkage. Nothing here is persisted.
//
// Domain language (CONTEXT.md):
//   - Section: a top-level container. Numbered `n` (1, 2, 3, …).
//   - Subsection: a one-level-deep container under a Section. Numbered `n.k`.
//   - Line item: a row in a Section's direct items OR a Subsection's items.
//     Direct item → `n.k`; subsection item → `n.k.m`.
//
// Within a Section the second-level counter is *shared* between subsections and
// direct items, and runs in render order: subsections first (1.1, 1.2, …), then
// the Section's loose direct items (continuing 1.3, 1.4, …).

import type { LineItemLike, SubsectionLike, SectionLike } from "./move-line-item";

export type NumberedRowKind = "section" | "subsection" | "item";

export interface NumberedRow {
  /** Entity id — a Section, Subsection, or Line item id. */
  id: string;
  kind: NumberedRowKind;
  /** Derived display number, e.g. "1", "2.3", "2.3.1". Never persisted. */
  number: string;
}

function bySortOrder<T extends { sort_order: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order);
}

export function numberSectionTree<
  I extends LineItemLike,
  Sub extends SubsectionLike<I>,
  Sec extends SectionLike<I, Sub>,
>(sections: Sec[]): NumberedRow[] {
  const rows: NumberedRow[] = [];

  bySortOrder(sections).forEach((section, si) => {
    const n = si + 1;
    rows.push({ id: section.id, kind: "section", number: `${n}` });

    // Second-level counter `k`, shared between subsections and direct items and
    // advanced in render order: subsections first, then the Section's loose items.
    let k = 0;

    bySortOrder(section.subsections).forEach((subsection) => {
      k += 1;
      rows.push({ id: subsection.id, kind: "subsection", number: `${n}.${k}` });
      bySortOrder(subsection.items).forEach((it, mi) => {
        rows.push({ id: it.id, kind: "item", number: `${n}.${k}.${mi + 1}` });
      });
    });

    bySortOrder(section.items).forEach((it) => {
      k += 1;
      rows.push({ id: it.id, kind: "item", number: `${n}.${k}` });
    });
  });

  return rows;
}

/**
 * Read-model convenience: `id → derived number` for O(1) lookup while rendering.
 * Re-run it over the current tree whenever rows are added, removed, or reordered;
 * the numbering recomputes from scratch (it stores nothing).
 */
export function buildNumberIndex<
  I extends LineItemLike,
  Sub extends SubsectionLike<I>,
  Sec extends SectionLike<I, Sub>,
>(sections: Sec[]): Map<string, string> {
  return new Map(numberSectionTree(sections).map((row) => [row.id, row.number]));
}
