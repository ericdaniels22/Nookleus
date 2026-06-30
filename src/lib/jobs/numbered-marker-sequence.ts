// Issue #816 — the one pure place that decides the number a freshly-dropped
// Numbered marker gets. Each drop is auto-assigned the next number in the
// Photo's sequence so placement order is deterministic and unit-testable. Kept
// free of Fabric/DOM/React so the rule lives in exactly one tested place — the
// annotator's tap-to-drop handler reads `existing marker numbers` off the
// canvas (via existingMarkerNumbers) and asks this for the next one.

import { annotationKind } from "./annotation-toolbar";

/**
 * The number to assign the next Numbered marker dropped on a Photo, given the
 * numbers of the markers already on it. An empty Photo starts the sequence at
 * 1; otherwise the next number continues from the highest already present (so
 * markers 1, 2, 3 yield 4). It is the highest-plus-one, not the count-plus-one,
 * so a deleted marker is never resequenced and never re-used (#816 scope
 * boundary — auto-renumber-on-delete is a separate slice).
 */
export function nextMarkerNumber(existingNumbers: number[]): number {
  if (existingNumbers.length === 0) return 1;
  return Math.max(...existingNumbers) + 1;
}

/**
 * The marker numbers already on a Photo, read from the canvas's objects and fed
 * straight into {@link nextMarkerNumber}. Crucially it classifies each object
 * through {@link annotationKind} — the same case-insensitive source of truth the
 * delete path uses — rather than matching a PascalCase class name. A *live*
 * Fabric instance reports a lowercase `type` (`"fabricnumberedmarker"`), so the
 * old `o.type === "FabricNumberedMarker"` filter never matched and every drop
 * was badged 1 (#852/#831). Operating on the `{ type, markerNumber }` shape (not
 * Fabric itself) keeps this module Fabric-free while add and delete agree on
 * what a marker is.
 */
export function existingMarkerNumbers(
  objects: ReadonlyArray<{ type?: string | null; markerNumber?: number }>,
): number[] {
  return objects
    .filter((o) => annotationKind(o?.type) === "marker")
    .map((o) => o.markerNumber as number);
}

/** A Numbered marker as the sequencing rules see it: a stable identity and the
 *  number currently shown on its badge. The annotator keys `id` off the marker's
 *  current number (unique per Photo, since {@link nextMarkerNumber} never re-uses
 *  one) and reads `number` back to re-badge the surviving markers. */
export interface NumberedMarker {
  id: string;
  number: number;
}

/**
 * The other half of the sequencing rule (#817): after a Numbered marker is
 * deleted, the survivors must renumber so the visible sequence stays contiguous
 * — 1, 2, 3 with no gap and no duplicate. Given every marker on the Photo and
 * the id of the one being deleted, this drops that marker and re-badges the rest
 * 1..n in their existing relative order (lowest current number first), so a
 * middle delete closes the gap while positions are untouched. Lives beside
 * {@link nextMarkerNumber} so add and delete share one tested source of truth.
 */
export function renumberAfterDelete(
  markers: NumberedMarker[],
  deletedId: string,
): NumberedMarker[] {
  return markers
    .filter((marker) => marker.id !== deletedId)
    .sort((a, b) => a.number - b.number)
    .map((marker, index) => ({ ...marker, number: index + 1 }));
}
