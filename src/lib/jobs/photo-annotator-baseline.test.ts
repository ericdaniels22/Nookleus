// Issue #853 — resetting the undo/redo baseline after a crop/rotate rebuild.
// Applying a crop (and a rotate) rebuilds the canvas: a crop removes every
// annotation, swaps in the cropped background and rescales the canvas, while a
// rotate re-dimensions the canvas around a rotated background. Both leave the
// history's `present` describing the PRE-rebuild annotations at coordinates that
// no longer match the canvas — so an Undo would replay stale markup onto the new
// image. `reseedBaseline` is the "reset the stack to the rebuilt canvas"
// operation the annotator runs at each boundary; these tests pin its contract
// against a real Fabric canvas (the `canvas` package gives jsdom a 2D context).

import { describe, it, expect } from "vitest";
import { StaticCanvas, Rect } from "fabric";

import { reseedBaseline, snapshotMarkup } from "./photo-annotator-baseline";
import {
  createHistory,
  push,
  canUndo,
  canRedo,
  type HistoryState,
} from "./photo-annotator-history";
import { type Annotation } from "./photo-annotation-format";

describe("reseedBaseline — reset the undo/redo baseline after a crop/rotate rebuild (#853)", () => {
  it("after a crop empties the canvas, the baseline present matches the empty canvas with nothing to undo", () => {
    const canvas = new StaticCanvas(undefined, { renderOnAddRemove: false });
    canvas.add(new Rect({ left: 10, top: 10, width: 20, height: 20 }));

    // The session already had undoable edits — a real undo target sat in `past`.
    let history: HistoryState<Annotation[]> = push(
      createHistory<Annotation[]>([]),
      [{ type: "FabricArrow" }],
    );
    expect(canUndo(history)).toBe(true);

    // Apply Crop rebuilds the canvas: every annotation is removed.
    canvas.getObjects().forEach((obj) => canvas.remove(obj));

    // Reseed the history to the rebuilt (empty) canvas.
    history = reseedBaseline(canvas);

    expect(history.present).toEqual([]); // matches the now-empty canvas
    expect(canUndo(history)).toBe(false); // Undo can't step across the crop
    expect(canRedo(history)).toBe(false);
  });

  it("after a rotate keeps the annotations, the baseline adopts the current canvas snapshot with undo/redo disabled", () => {
    const canvas = new StaticCanvas(undefined, { renderOnAddRemove: false });
    // Rotate (unlike crop) re-dimensions the canvas around a rotated background
    // but leaves the annotations on it — so the new baseline is non-empty.
    canvas.add(new Rect({ left: 5, top: 5, width: 10, height: 10 }));

    // The session already had undoable edits before the rotate.
    let history: HistoryState<Annotation[]> = push(
      createHistory<Annotation[]>([]),
      [{ type: "FabricArrow" }],
    );
    expect(canUndo(history)).toBe(true);

    history = reseedBaseline(canvas);

    // The present is the rotated canvas's own markup, not the pre-rotate snapshot…
    expect(history.present).toEqual(snapshotMarkup(canvas));
    expect(history.present).toHaveLength(1);
    // …and the prior undo reach is gone: Undo can't step back into the
    // pre-rotate coordinate frame.
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });
});
