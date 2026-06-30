// Issue #853 — reseed the undo/redo baseline after a crop/rotate rebuild.
//
// Applying a crop or a rotate rebuilds the canvas: a crop removes every
// annotation, swaps in the cropped background and rescales the canvas; a rotate
// re-dimensions the canvas around a rotated background. Either way the markup's
// coordinate frame changes, so the history's existing `present` (and everything
// in `past`) describes annotations at coordinates that no longer match the
// canvas. Replaying one via Undo would repaint stale markup onto the new image.
//
// This module owns the single "snapshot the current canvas and reset the stack
// to it" operation the annotator runs at each rebuild boundary — the same reseed
// the photo-load path performs in `initCanvas`. It deliberately discards the
// prior undo/redo reach: making crop/rotate itself undoable would require the
// snapshot model to version the background image too, which it does not today.
// Keeping the snapshot + reset here gives the load path and both rebuild paths
// one definition of "the new baseline", and makes that decision testable against
// a real canvas without the React component.

import {
  ANNOTATION_CUSTOM_PROPS,
  type Annotation,
} from "./photo-annotation-format";
import { createHistory, type HistoryState } from "./photo-annotator-history";

/** The slice of a Fabric canvas this module reads: the markup projection. The
 *  real `fabric.Canvas`/`StaticCanvas` satisfies it structurally, so callers
 *  pass their live canvas and tests pass a headless `StaticCanvas`. */
export interface MarkupCanvas {
  toJSON(propertiesToInclude?: string[]): { objects: Annotation[] };
}

/** Snapshot the markup objects currently on the canvas, carrying each
 *  Annotation's custom props (an arrow's geometry/colour/label, a marker's
 *  number) so the snapshot round-trips. The background photo is not part of
 *  `objects`, so only the user-placed annotations are versioned. */
export function snapshotMarkup(canvas: MarkupCanvas): Annotation[] {
  return canvas.toJSON([...ANNOTATION_CUSTOM_PROPS]).objects;
}

/** Reset the undo/redo stack to the canvas's current state as a brand-new
 *  baseline, with nothing to undo or redo. Run after a crop/rotate rebuild (and
 *  on photo load) so Undo can never step back across the boundary onto a
 *  snapshot that no longer matches the canvas. */
export function reseedBaseline(
  canvas: MarkupCanvas,
): HistoryState<Annotation[]> {
  return createHistory(snapshotMarkup(canvas));
}
