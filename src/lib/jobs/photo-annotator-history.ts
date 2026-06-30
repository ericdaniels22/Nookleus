// Issue #813 — Undo / Redo history stack for the photo annotator (PRD #804).
// The pure "history brain": the canvas states the annotator can step back and
// forth through, and how a completed step, an undo, a redo, or a history reset
// move between them. It has no React and no Fabric in it on purpose — the
// annotator wraps these transitions and only ever hands in/reads back opaque
// snapshots, so arrow placement, marker drops, label edits, moves, resizes,
// deletes and clear-all all funnel through the same stack and can never
// disagree about what "the previous state" is. Keeping the transitions here
// makes them trivially testable (apply an operation, assert the next state)
// without a canvas.
//
// The model is the classic past / present / future triple: `past` is the stack
// of states we can undo back into (oldest first), `present` is what the canvas
// currently shows, and `future` is the redo branch (next-to-redo first).

/** A point-in-time history with everything behind and ahead of the present. */
export interface HistoryState<T> {
  /** States we can step back into, oldest first; empty when nothing to undo. */
  past: T[];
  /** The state the canvas currently reflects. */
  present: T;
  /** The redo branch, next-to-redo first; empty when nothing to redo. */
  future: T[];
}

/** A fresh history holding only the current state — no undo or redo yet. */
export function createHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] };
}

/**
 * Record a completed step. The old present drops onto the undo stack, the
 * snapshot becomes the new present, and the redo branch is discarded — starting
 * a fresh step after an undo must never leave a stale future to redo into.
 */
export function push<T>(history: HistoryState<T>, snapshot: T): HistoryState<T> {
  return {
    past: [...history.past, history.present],
    present: snapshot,
    future: [],
  };
}

/**
 * Step back to the previous state. The present moves onto the front of the redo
 * branch so a later redo can re-apply it. A no-op when there is nothing earlier
 * to return to.
 */
export function undo<T>(history: HistoryState<T>): HistoryState<T> {
  if (!canUndo(history)) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

/**
 * Re-apply the step the user just undid. The present drops back onto the undo
 * stack and the head of the redo branch becomes the new present. A no-op when
 * there is nothing to re-apply.
 */
export function redo<T>(history: HistoryState<T>): HistoryState<T> {
  if (!canRedo(history)) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  };
}

/**
 * Forget the undo and redo history, keeping only the current state. The
 * annotator resets the stack this way when it loads a different Photo so undo
 * can never step across into another Photo's edits. (This is the history-reset
 * operation — wiping the *canvas* with Clear-all is an ordinary `push` of an
 * empty snapshot, which is what makes Clear-all a single undoable step.)
 */
export function clear<T>(history: HistoryState<T>): HistoryState<T> {
  return createHistory(history.present);
}

/** True when there is an earlier state to step back into. */
export function canUndo<T>(history: HistoryState<T>): boolean {
  return history.past.length > 0;
}

/** True when there is an undone state to re-apply. */
export function canRedo<T>(history: HistoryState<T>): boolean {
  return history.future.length > 0;
}
