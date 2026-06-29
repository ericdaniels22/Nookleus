import { describe, it, expect } from "vitest";
import {
  initShowcaseBuilderState,
  showcaseBuilderReducer,
  type ShowcaseBuilderState,
} from "./showcase-builder";

// #613 — Showcase builder. The pure "builder brain" behind the full-page
// editor: the component wraps `showcaseBuilderReducer` in `useReducer` and the
// auto-save effect reads `state.dirty`. Keeping the transitions here makes them
// trivially testable (dispatch an action, assert the next state).

function loaded(
  over: Partial<{ title: string; write_up: string; photo_ids: string[] }> = {},
) {
  return {
    title: "Kitchen remodel",
    write_up: "We rebuilt the kitchen.",
    photo_ids: ["p1", "p2"],
    ...over,
  };
}

describe("initShowcaseBuilderState", () => {
  it("seeds builder state from a loaded showcase and starts not dirty", () => {
    const state = initShowcaseBuilderState(loaded());

    expect(state).toMatchObject<Partial<ShowcaseBuilderState>>({
      title: "Kitchen remodel",
      writeUp: "We rebuilt the kitchen.",
      photoIds: ["p1", "p2"],
      dirty: false,
    });
  });
});

describe("showcaseBuilderReducer", () => {
  it("setTitle edits the title, dirties, and bumps the revision", () => {
    const state = initShowcaseBuilderState(loaded());

    const next = showcaseBuilderReducer(state, {
      type: "setTitle",
      title: "Bathroom remodel",
    });

    expect(next.title).toBe("Bathroom remodel");
    expect(next.dirty).toBe(true);
    expect(next.revision).toBe(state.revision + 1);
  });

  it("setWriteUp edits the write-up, dirties, and bumps the revision", () => {
    const state = initShowcaseBuilderState(loaded());

    const next = showcaseBuilderReducer(state, {
      type: "setWriteUp",
      writeUp: "A full gut renovation, top to bottom.",
    });

    expect(next.writeUp).toBe("A full gut renovation, top to bottom.");
    expect(next.dirty).toBe(true);
    expect(next.revision).toBe(state.revision + 1);
  });

  it("addPhoto appends a newly chosen photo to the end and dirties", () => {
    const state = initShowcaseBuilderState(loaded({ photo_ids: ["p1", "p2"] }));

    const next = showcaseBuilderReducer(state, {
      type: "addPhoto",
      photoId: "p3",
    });

    expect(next.photoIds).toEqual(["p1", "p2", "p3"]);
    expect(next.dirty).toBe(true);
    expect(next.revision).toBe(state.revision + 1);
  });

  it("addPhoto is a no-op for a photo already chosen (no reorder, stays clean)", () => {
    const state = initShowcaseBuilderState(loaded({ photo_ids: ["p1", "p2"] }));

    const next = showcaseBuilderReducer(state, {
      type: "addPhoto",
      photoId: "p1",
    });

    expect(next).toBe(state); // same reference — nothing changed
  });

  it("removePhoto takes a chosen photo out of the gallery and dirties", () => {
    const state = initShowcaseBuilderState(
      loaded({ photo_ids: ["p1", "p2", "p3"] }),
    );

    const next = showcaseBuilderReducer(state, {
      type: "removePhoto",
      photoId: "p2",
    });

    expect(next.photoIds).toEqual(["p1", "p3"]);
    expect(next.dirty).toBe(true);
    expect(next.revision).toBe(state.revision + 1);
  });

  it("removePhoto is a no-op for a photo that is not in the gallery", () => {
    const state = initShowcaseBuilderState(loaded({ photo_ids: ["p1", "p2"] }));

    const next = showcaseBuilderReducer(state, {
      type: "removePhoto",
      photoId: "nope",
    });

    expect(next).toBe(state);
  });

  it("reorderPhoto moves a photo to a new position (arrayMove) and dirties", () => {
    const state = initShowcaseBuilderState(
      loaded({ photo_ids: ["p1", "p2", "p3"] }),
    );

    const next = showcaseBuilderReducer(state, {
      type: "reorderPhoto",
      from: 0,
      to: 2,
    });

    expect(next.photoIds).toEqual(["p2", "p3", "p1"]);
    expect(next.dirty).toBe(true);
    expect(next.revision).toBe(state.revision + 1);
  });

  it("reorderPhoto is a no-op when from === to or an index is out of range", () => {
    const state = initShowcaseBuilderState(loaded({ photo_ids: ["p1", "p2"] }));

    expect(
      showcaseBuilderReducer(state, { type: "reorderPhoto", from: 1, to: 1 }),
    ).toBe(state);
    expect(
      showcaseBuilderReducer(state, { type: "reorderPhoto", from: 0, to: 5 }),
    ).toBe(state);
    expect(
      showcaseBuilderReducer(state, { type: "reorderPhoto", from: -1, to: 0 }),
    ).toBe(state);
  });

  it("markSaved clears dirty when the saved revision is the current one", () => {
    const dirty = showcaseBuilderReducer(initShowcaseBuilderState(loaded()), {
      type: "setTitle",
      title: "x",
    });

    const saved = showcaseBuilderReducer(dirty, {
      type: "markSaved",
      revision: dirty.revision,
    });

    expect(saved.dirty).toBe(false);
  });

  it("markSaved keeps dirty when an edit landed while the save was in flight", () => {
    const afterFirstEdit = showcaseBuilderReducer(
      initShowcaseBuilderState(loaded()),
      { type: "setTitle", title: "x" }, // revision 1, save begins for this
    );
    const afterSecondEdit = showcaseBuilderReducer(afterFirstEdit, {
      type: "setWriteUp",
      writeUp: "y", // revision 2 — lands before the rev-1 save returns
    });

    const saved = showcaseBuilderReducer(afterSecondEdit, {
      type: "markSaved",
      revision: afterFirstEdit.revision, // stale ack for revision 1
    });

    expect(saved.dirty).toBe(true);
    expect(saved).toBe(afterSecondEdit); // untouched — newer value still pending
  });
});
