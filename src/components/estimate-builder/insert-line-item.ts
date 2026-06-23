// Pure helpers for inserting Line items into the Section / Subsection tree.
//
// Sibling to move-line-item.ts: isolated from React and dnd-kit so they can be
// unit tested in plain Node and reused across the template, estimate, and
// invoice builder modes.
//
// Domain language (CONTEXT.md):
//   - Section: a top-level container in the estimate / invoice / template tree.
//   - Subsection: a one-level-deep container nested under a Section.
//   - Line item: a row inside a Section's direct items list OR a Subsection's
//     items list. Its parent container's id is the line item's "container id".

import type { LineItemLike, SectionLike, SubsectionLike } from "./move-line-item";

export type { LineItemLike, SectionLike, SubsectionLike };

// ─────────────────────────────────────────────────────────────────────────────
// insertLineItemAtContainerTop
// ─────────────────────────────────────────────────────────────────────────────

export function insertLineItemAtContainerTop<
  I extends LineItemLike,
  Sub extends SubsectionLike<I>,
  Sec extends SectionLike<I, Sub>,
>(sections: Sec[], containerId: string, item: I): Sec[] {
  return sections.map((section) => {
    if (section.id === containerId) {
      return { ...section, items: prependAndRecompact(section.items, containerId, item) };
    }
    let touched = false;
    const subsections = section.subsections.map((subsection) => {
      if (subsection.id === containerId) {
        touched = true;
        return { ...subsection, items: prependAndRecompact(subsection.items, containerId, item) };
      }
      return subsection;
    });
    return touched ? { ...section, subsections } : section;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function prependAndRecompact<I extends LineItemLike>(
  items: I[],
  containerId: string,
  newItem: I,
): I[] {
  const placed: I = "section_id" in newItem
    ? ({ ...newItem, section_id: containerId } as I)
    : ({ ...newItem } as I);
  return [placed, ...items].map((it, idx) => ({ ...it, sort_order: idx }));
}
