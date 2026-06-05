// Issue #401 — Photo Report Rework, Slice 2b.
//
// The pure drag-end resolver for the in-Job Photo Report builder. It maps a
// dnd-kit DragEndEvent into a single builder reducer action (or null for a
// no-op), so the component's onDragEnd is a one-liner and the mapping is unit
// testable without React. Mirrors estimate-builder/move-line-item.ts.
//
// The builder attaches a `data.current` descriptor to each node:
//   - a Section container (the only drop target): { type: "section", index }
//   - a Photo (a drag source only): { type: "photo", photoId, sectionIndex? }
//     A photo already in a Section carries its sectionIndex; a photo in the "not
//     in the report" tray carries none. Photos are draggable but not droppable,
//     so a drop's `over` is always a Section (or null).

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
    const to = overData.type === "section" ? numberOrNull(overData.index) : null;
    if (from === null || to === null || from === to) return null;
    return { type: "reorderSection", from, to };
  }

  if (activeData.type === "photo") {
    const photoId = typeof activeData.photoId === "string" ? activeData.photoId : null;
    const sectionIndex = dropTargetSectionIndex(overData);
    if (photoId === null || sectionIndex === null) return null;
    // A photo dropped back onto the Section it already belongs to is a no-op (no
    // within-section reordering this slice). Tray photos carry no sectionIndex,
    // so they always assign.
    if (numberOrNull(activeData.sectionIndex) === sectionIndex) return null;
    return { type: "assignPhotoToSection", photoId, sectionIndex };
  }

  return null;
}

// The Section index a drop lands in. Sections are the only drop targets (photos
// are draggable but not droppable), so a drop's `over` is always a Section.
function dropTargetSectionIndex(
  overData: Record<string, unknown>,
): number | null {
  if (overData.type === "section") return numberOrNull(overData.index);
  return null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
