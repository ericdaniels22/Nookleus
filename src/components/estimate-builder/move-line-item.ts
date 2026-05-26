// Pure helpers for cross-container Line item drag-and-drop.
//
// Isolated from React and from dnd-kit's React bindings so they can be unit
// tested in plain Node and reused across the template, estimate, and invoice
// builder modes.
//
// Domain language (CONTEXT.md):
//   - Section: a top-level container in the estimate / invoice / template tree.
//   - Subsection: a one-level-deep container nested under a Section.
//   - Line item: a row inside a Section's direct items list OR a Subsection's
//     items list. Its parent container's id is the line item's "container id".
//
// Both helpers are generic over the line-item shape so they work for both
// estimate/invoice items (which carry `section_id`) and template items (which
// do not — their parentage is implied by tree position).

export interface LineItemLike {
  id: string;
  sort_order: number;
  section_id?: string | null;
}

export interface SubsectionLike<I extends LineItemLike = LineItemLike> {
  id: string;
  sort_order: number;
  items: I[];
}

export interface SectionLike<
  I extends LineItemLike = LineItemLike,
  Sub extends SubsectionLike<I> = SubsectionLike<I>,
> {
  id: string;
  sort_order: number;
  items: I[];
  subsections: Sub[];
}

export interface AffectedItem {
  id: string;
  section_id: string;
  sort_order: number;
}

export interface MoveLineItemResult<Sec> {
  sections: Sec[];
  affectedItems: AffectedItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// moveLineItemAcrossContainers
// ─────────────────────────────────────────────────────────────────────────────

export function moveLineItemAcrossContainers<
  I extends LineItemLike,
  Sub extends SubsectionLike<I>,
  Sec extends SectionLike<I, Sub>,
>(
  sections: Sec[],
  activeItemId: string,
  destinationContainerId: string,
  overItemId: string | null,
): MoveLineItemResult<Sec> | null {
  // Locate the source container + the active item.
  const located = locateItem(sections, activeItemId);
  if (!located) return null;
  const { sourceContainerId, item: activeItem } = located;

  // Drop-on-self: same container + over-item id equals active id.
  if (overItemId === activeItemId && sourceContainerId === destinationContainerId) {
    return null;
  }

  // Confirm the destination container exists somewhere in the tree.
  if (!containerExists(sections, destinationContainerId)) return null;

  // Build the moved item with its new section_id (only when the field already
  // exists — template-shape items don't carry one).
  const movedItem: I = "section_id" in activeItem
    ? ({ ...activeItem, section_id: destinationContainerId } as I)
    : ({ ...activeItem } as I);

  // Walk the tree once. For every container, drop the active item if present
  // (source), then insert it if this is the destination, then recompact sort_order.
  const nextSections = sections.map((section) =>
    rewriteContainer(section, activeItemId, destinationContainerId, overItemId, movedItem),
  );

  // Collect affected items — every item in the source and destination containers.
  const affectedIds = new Set<string>([sourceContainerId, destinationContainerId]);
  const affectedItems: AffectedItem[] = [];
  for (const section of nextSections) {
    if (affectedIds.has(section.id)) {
      for (const it of section.items) {
        affectedItems.push({ id: it.id, section_id: section.id, sort_order: it.sort_order });
      }
    }
    for (const sub of section.subsections) {
      if (affectedIds.has(sub.id)) {
        for (const it of sub.items) {
          affectedItems.push({ id: it.id, section_id: sub.id, sort_order: it.sort_order });
        }
      }
    }
  }

  return { sections: nextSections, affectedItems };
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveLineItemDropTarget
// ─────────────────────────────────────────────────────────────────────────────

interface DndOverObject {
  id: string | number;
  data?: { current?: Record<string, unknown> | null } | null;
}

export interface ResolvedDropTarget {
  destinationContainerId: string;
  overItemId?: string;
}

export function resolveLineItemDropTarget(
  over: DndOverObject | null | undefined,
): ResolvedDropTarget | null {
  if (!over) return null;
  const data = over.data?.current ?? null;
  if (!data) return null;
  const type = data.type;

  if (type === "line-item") {
    const parentSectionId = data.parentSectionId;
    if (typeof parentSectionId !== "string") return null;
    return { destinationContainerId: parentSectionId, overItemId: String(over.id) };
  }

  if (type === "section" || type === "subsection") {
    return { destinationContainerId: String(over.id) };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function locateItem<I extends LineItemLike, Sub extends SubsectionLike<I>, Sec extends SectionLike<I, Sub>>(
  sections: Sec[],
  itemId: string,
): { sourceContainerId: string; item: I } | null {
  for (const section of sections) {
    const direct = section.items.find((i) => i.id === itemId);
    if (direct) return { sourceContainerId: section.id, item: direct };
    for (const sub of section.subsections) {
      const nested = sub.items.find((i) => i.id === itemId);
      if (nested) return { sourceContainerId: sub.id, item: nested };
    }
  }
  return null;
}

function containerExists<I extends LineItemLike, Sub extends SubsectionLike<I>, Sec extends SectionLike<I, Sub>>(
  sections: Sec[],
  containerId: string,
): boolean {
  for (const section of sections) {
    if (section.id === containerId) return true;
    for (const sub of section.subsections) {
      if (sub.id === containerId) return true;
    }
  }
  return false;
}

function rewriteContainer<
  I extends LineItemLike,
  Sub extends SubsectionLike<I>,
  Sec extends SectionLike<I, Sub>,
>(
  section: Sec,
  activeItemId: string,
  destinationContainerId: string,
  overItemId: string | null,
  movedItem: I,
): Sec {
  const nextSubsections = section.subsections.map((sub) =>
    rewriteSubsection(sub, activeItemId, destinationContainerId, overItemId, movedItem),
  );

  const nextDirectItems = applyContainerMutation(
    section.id,
    section.items,
    activeItemId,
    destinationContainerId,
    overItemId,
    movedItem,
  );

  return { ...section, items: nextDirectItems, subsections: nextSubsections };
}

function rewriteSubsection<I extends LineItemLike, Sub extends SubsectionLike<I>>(
  sub: Sub,
  activeItemId: string,
  destinationContainerId: string,
  overItemId: string | null,
  movedItem: I,
): Sub {
  const nextItems = applyContainerMutation(
    sub.id,
    sub.items,
    activeItemId,
    destinationContainerId,
    overItemId,
    movedItem,
  );
  return { ...sub, items: nextItems };
}

function applyContainerMutation<I extends LineItemLike>(
  containerId: string,
  items: I[],
  activeItemId: string,
  destinationContainerId: string,
  overItemId: string | null,
  movedItem: I,
): I[] {
  const oldIdx = items.findIndex((i) => i.id === activeItemId);
  const isSource = oldIdx !== -1;
  const isDestination = containerId === destinationContainerId;

  if (!isSource && !isDestination) return items;

  // 1. Remove the active item if it lives here.
  const withoutActive = isSource ? items.filter((i) => i.id !== activeItemId) : items.slice();

  // 2. Insert the moved item if this container is the destination.
  let nextItems = withoutActive;
  if (isDestination) {
    let insertIdx = withoutActive.length; // chrome-drop → append
    if (overItemId !== null && overItemId !== activeItemId) {
      const overIdxInWithout = withoutActive.findIndex((i) => i.id === overItemId);
      if (overIdxInWithout !== -1) {
        // Same-container drop-on-item: mirror dnd-kit's arrayMove. When the
        // drag is downward in the same list (oldIdx < newIdx), the item lands
        // *after* the over item — splice-after semantics. Upward drags and
        // all cross-container drops land *at* the over item's index.
        if (isSource) {
          const newIdxInOriginal = items.findIndex((i) => i.id === overItemId);
          insertIdx = oldIdx < newIdxInOriginal ? overIdxInWithout + 1 : overIdxInWithout;
        } else {
          insertIdx = overIdxInWithout;
        }
      }
    }
    nextItems = [...withoutActive.slice(0, insertIdx), movedItem, ...withoutActive.slice(insertIdx)];
  }

  if (!isSource && !isDestination) return items;

  return nextItems.map((it, idx) => ({ ...it, sort_order: idx }));
}
