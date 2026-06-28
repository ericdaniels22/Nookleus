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
// insertLineItemAfter
// ─────────────────────────────────────────────────────────────────────────────

// Insert `item` directly after the sibling identified by `siblingId`, within the
// sibling's own container (Section direct items OR a Subsection's items). The
// inserted item's section_id is normalized to that container and the container's
// sort_order is recompacted to 0..N-1. Returns the tree unchanged when the
// sibling is not found anywhere in the tree.
export function insertLineItemAfter<
  I extends LineItemLike,
  Sub extends SubsectionLike<I>,
  Sec extends SectionLike<I, Sub>,
>(sections: Sec[], siblingId: string, item: I): Sec[] {
  return sections.map((section) => {
    if (section.items.some((it) => it.id === siblingId)) {
      return { ...section, items: insertAfterAndRecompact(section.items, section.id, siblingId, item) };
    }
    let touched = false;
    const subsections = section.subsections.map((subsection) => {
      if (subsection.items.some((it) => it.id === siblingId)) {
        touched = true;
        return {
          ...subsection,
          items: insertAfterAndRecompact(subsection.items, subsection.id, siblingId, item),
        };
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

function insertAfterAndRecompact<I extends LineItemLike>(
  items: I[],
  containerId: string,
  siblingId: string,
  newItem: I,
): I[] {
  const placed: I = "section_id" in newItem
    ? ({ ...newItem, section_id: containerId } as I)
    : ({ ...newItem } as I);
  const siblingIdx = items.findIndex((it) => it.id === siblingId);
  const next = items.slice();
  next.splice(siblingIdx + 1, 0, placed);
  return next.map((it, idx) => ({ ...it, sort_order: idx }));
}
