// Issue #854 — a committed text edit must land as exactly ONE undo step.
//
// Fabric v7's IText.exitEditing() fires, back to back on the canvas,
// `text:editing:exited` and then (only when the text changed) `object:modified`
// (see fabric/dist/index.mjs exitEditing). The annotator records a step on BOTH
// — text:editing:exited owns the text commit, and object:modified owns every
// move/resize/endpoint-drag — so without a guard one text edit pushes twice and
// the user must Undo twice to revert it.
//
// These tests mount a LIVE Fabric canvas (node-canvas backs jsdom's <canvas>, so
// real IText editing runs) and wire the two handlers exactly as the annotator
// does, over the real history brain, asserting one push per text commit while
// non-text moves still record.

import { describe, it, expect } from "vitest";
import { Canvas, IText, Rect } from "fabric";
import {
  createHistory,
  push,
  type HistoryState,
} from "@/lib/jobs/photo-annotator-history";
import { shouldRecordModifiedStep } from "@/lib/jobs/annotation-history-events";

/** A live Fabric canvas wired the way the annotator wires history recording:
 *  text:editing:exited records the text commit; object:modified records every
 *  OTHER kind's move/resize but defers the text kind to text:editing:exited. */
function mountWiredCanvas() {
  const el = document.createElement("canvas");
  const canvas = new Canvas(el, { renderOnAddRemove: false });
  let history: HistoryState<number> = createHistory(0);
  let serial = 0;
  const recordStep = () => {
    history = push(history, ++serial);
  };
  canvas.on("text:editing:exited", () => recordStep());
  canvas.on("object:modified", (e: { target?: { type?: string } }) => {
    if (shouldRecordModifiedStep(e.target)) recordStep();
  });
  return { canvas, undoDepth: () => history.past.length };
}

describe("text edit commit history (#854)", () => {
  it("records exactly one undo step when an existing text edit is committed", () => {
    const { canvas, undoDepth } = mountWiredCanvas();
    const text = new IText("Before", { left: 10, top: 10 });
    canvas.add(text);
    canvas.setActiveObject(text);

    text.enterEditing();
    text.text = "After";
    text.exitEditing();

    expect(undoDepth()).toBe(1);
  });

  it("still records one step when a non-text annotation is moved/resized", () => {
    const { canvas, undoDepth } = mountWiredCanvas();
    const rect = new Rect({ left: 10, top: 10, width: 40, height: 30 });
    canvas.add(rect);
    canvas.setActiveObject(rect);

    // A finished move/resize fires object:modified once (no text:editing:exited).
    rect.set({ left: 80, top: 60 });
    canvas.fire("object:modified", { target: rect });

    expect(undoDepth()).toBe(1);
  });

  it("records one step when a brand-new text box is placed and committed", () => {
    const { canvas, undoDepth } = mountWiredCanvas();
    // Mirror the text tool: drop a fresh IText, enter editing immediately, type,
    // then commit by exiting — the new box must land as exactly one undo step.
    const text = new IText("Text", { left: 20, top: 20 });
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    text.text = "Hello";
    text.exitEditing();

    expect(undoDepth()).toBe(1);
  });
});

describe("shouldRecordModifiedStep kind policy", () => {
  it("defers the text kind (live i-text and serialized IText) to text:editing:exited", () => {
    expect(shouldRecordModifiedStep({ type: "i-text" })).toBe(false);
    expect(shouldRecordModifiedStep({ type: "IText" })).toBe(false);
  });

  it("records for every non-text kind and for non-Annotation targets", () => {
    expect(shouldRecordModifiedStep({ type: "rect" })).toBe(true);
    expect(shouldRecordModifiedStep({ type: "fabricarrow" })).toBe(true);
    expect(shouldRecordModifiedStep({ type: "fabricnumberedmarker" })).toBe(true);
    expect(shouldRecordModifiedStep({ type: "image" })).toBe(true);
    expect(shouldRecordModifiedStep(undefined)).toBe(true);
  });
});
