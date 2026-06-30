import { describe, it, expect } from "vitest";
import {
  createHistory,
  push,
  undo,
  redo,
  clear,
  canUndo,
  canRedo,
  MAX_HISTORY_DEPTH,
} from "./photo-annotator-history";

describe("photo annotator history stack", () => {
  it("starts with the given present and nothing to undo or redo", () => {
    const history = createHistory("a");

    expect(history.present).toBe("a");
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it("push records a completed step as the new present and makes it undoable", () => {
    const history = push(createHistory("a"), "b");

    expect(history.present).toBe("b");
    expect(canUndo(history)).toBe(true);
  });

  it("undo steps the present back to the previous state and offers a redo", () => {
    const history = undo(push(createHistory("a"), "b"));

    expect(history.present).toBe("a");
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(true);
  });

  it("undo at the empty start is a no-op", () => {
    const start = createHistory("a");

    const history = undo(start);

    expect(history).toEqual(start);
  });

  it("redo re-applies the step the user just undid", () => {
    const history = redo(undo(push(createHistory("a"), "b")));

    expect(history.present).toBe("b");
    expect(canRedo(history)).toBe(false);
  });

  it("redo with nothing to re-apply is a no-op", () => {
    const start = push(createHistory("a"), "b");

    const history = redo(start);

    expect(history).toEqual(start);
  });

  it("clear forgets the undo and redo history but keeps the present", () => {
    const built = undo(push(push(createHistory("a"), "b"), "c"));

    const history = clear(built);

    expect(history.present).toBe(built.present);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  describe("history invariants", () => {
    it("a fresh step after an undo clears the redo branch for good", () => {
      // Place "b", undo back to "a" (so "b" is sitting in the redo branch),
      // then start a new step "c". The undone "b" must be unrecoverable.
      const afterUndo = undo(push(createHistory("a"), "b"));
      expect(canRedo(afterUndo)).toBe(true);

      const history = push(afterUndo, "c");

      expect(history.present).toBe("c");
      expect(canRedo(history)).toBe(false);
      expect(redo(history)).toEqual(history);
    });

    it("canUndo and canRedo are both false at the empty start", () => {
      const start = createHistory("a");

      expect(canUndo(start)).toBe(false);
      expect(canRedo(start)).toBe(false);
    });

    it("canUndo goes false once every step is undone", () => {
      let history = push(push(push(createHistory("a"), "b"), "c"), "d");

      history = undo(undo(undo(history)));

      expect(history.present).toBe("a");
      expect(canUndo(history)).toBe(false);
    });

    it("canRedo goes false once every undone step is redone", () => {
      const built = push(push(push(createHistory("a"), "b"), "c"), "d");

      let history = undo(undo(undo(built)));
      history = redo(redo(redo(history)));

      expect(history.present).toBe("d");
      expect(canRedo(history)).toBe(false);
    });

    it("an undo followed by a redo round-trips to the identical state", () => {
      const built = push(push(createHistory("a"), "b"), "c");

      const roundTripped = redo(undo(built));

      expect(roundTripped).toEqual(built);
    });

    it("steps through a multi-step sequence in order", () => {
      const built = push(push(push(createHistory("a"), "b"), "c"), "d");

      const back = undo(undo(built));
      expect(back.present).toBe("b");

      const forward = redo(back);
      expect(forward.present).toBe("c");
    });
  });

  describe("bounded depth — a long editing session can't grow the stack forever", () => {
    it("drops the oldest undo states once the cap is exceeded, keeping the most recent", () => {
      // Cap at 3 so the test reads at a glance: snapshot 0..5 in order, then
      // only the three states immediately behind the present remain undoable;
      // the two oldest have fallen off the back.
      let history = createHistory(0);
      for (let step = 1; step <= 5; step++) {
        history = push(history, step, 3);
      }

      expect(history.present).toBe(5);
      expect(history.past).toEqual([2, 3, 4]);
      expect(history.future).toEqual([]);
    });

    it("never lets `past` exceed the cap no matter how many steps are pushed", () => {
      let history = createHistory("s0");
      for (let step = 1; step <= 200; step++) {
        history = push(history, `s${step}`, 10);
      }

      expect(history.past.length).toBe(10);
      // The survivors are the 10 states right behind the present (s190..s199),
      // and the present is the most recent snapshot.
      expect(history.present).toBe("s200");
      expect(history.past[0]).toBe("s190");
      expect(history.past[9]).toBe("s199");
    });

    it("caps at MAX_HISTORY_DEPTH by default when no explicit depth is given", () => {
      let history = createHistory(0);
      for (let step = 1; step <= MAX_HISTORY_DEPTH + 25; step++) {
        history = push(history, step);
      }

      expect(history.past.length).toBe(MAX_HISTORY_DEPTH);
      expect(history.present).toBe(MAX_HISTORY_DEPTH + 25);
    });

    it("leaves a short session untouched — nothing is dropped under the cap", () => {
      const history = push(push(push(createHistory("a"), "b"), "c"), "d");

      expect(history.past).toEqual(["a", "b", "c"]);
    });
  });
});
