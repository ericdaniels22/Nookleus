// Issue #401 — Photo Report Rework, Slice 2b.
//
// The pure drag-end resolver for the in-Job Photo Report builder. It maps a
// dnd-kit DragEndEvent into a single builder reducer action (or null for a
// no-op), so the component's onDragEnd is a one-liner and the mapping is unit
// testable without React. Mirrors estimate-builder/move-line-item.ts.
//
// The builder attaches a `data.current` descriptor to each node:
//   - a Section container: { type: "section", index }
//   - a Photo: { type: "photo", photoId, sectionIndex?, photoIndex? }
//     A photo already in a Section carries its sectionIndex and its position
//     within that Section's photo_ids (#552 made in-Section photos sortable, so
//     they are drop targets too); a photo in the phone-only "not in the report"
//     tray carries neither, and the tray itself is not a drop target.

import type { PhotoReportBuilderAction } from "./photo-report-builder";

interface DragNode {
  id: string | number;
  data?: { current?: Record<string, unknown> | null } | null;
}

export interface PhotoReportDragEndEvent {
  active: DragNode;
  over?: DragNode | null;
}

export function resolvePhotoReportDragEnd(
  event: PhotoReportDragEndEvent,
): PhotoReportBuilderAction | null {
  const { active, over } = event;
  if (!over) return null;
  const activeData = active.data?.current ?? null;
  const overData = over.data?.current ?? null;
  if (!activeData || !overData) return null;

  if (activeData.type === "section") {
    const from = numberOrNull(activeData.index);
    const to = dropTargetSectionIndex(overData);
    if (from === null || to === null || from === to) return null;
    return { type: "reorderSection", from, to };
  }

  if (activeData.type === "photo") {
    const photoId = typeof activeData.photoId === "string" ? activeData.photoId : null;
    if (photoId === null) return null;
    const fromSection = numberOrNull(activeData.sectionIndex);

    // A photo dropped onto another photo in its own Section reorders within it
    // (#552): the dragged photo lands at the target's position, dnd-kit's
    // arrayMove semantics.
    if (
      overData.type === "photo" &&
      fromSection !== null &&
      numberOrNull(overData.sectionIndex) === fromSection
    ) {
      const from = numberOrNull(activeData.photoIndex);
      const to = numberOrNull(overData.photoIndex);
      if (from === null || to === null || from === to) return null;
      return {
        type: "reorderPhotoWithinSection",
        sectionIndex: fromSection,
        from,
        to,
      };
    }

    const sectionIndex = dropTargetSectionIndex(overData);
    if (sectionIndex === null) return null;
    // A photo dropped back onto its own Section's container changes nothing —
    // assigning would surprise the user by jumping the photo to the end.
    if (fromSection === sectionIndex) return null;
    return { type: "assignPhotoToSection", photoId, sectionIndex };
  }

  return null;
}

// The Section index a drop lands in: the Section container itself, or — since
// in-Section photos are sortable and therefore droppable (#552) — a photo that
// lives in a Section, which stands in for its Section. Tray photos carry no
// sectionIndex and resolve to null (the tray is not a drop target).
function dropTargetSectionIndex(
  overData: Record<string, unknown>,
): number | null {
  if (overData.type === "section") return numberOrNull(overData.index);
  if (overData.type === "photo") return numberOrNull(overData.sectionIndex);
  return null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
