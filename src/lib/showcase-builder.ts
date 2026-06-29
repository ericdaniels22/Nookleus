// #613 — Showcase: entity + builder (drafts).
//
// The pure "builder brain" for the full-page Showcase editor. It has no React
// in it on purpose: the component wraps `showcaseBuilderReducer` in `useReducer`
// and the auto-save effect reads `state.dirty` to decide when to persist.
// Keeping the transitions here makes them trivially testable (dispatch an
// action, assert the next state). Mirrors `photo-report-builder.ts`: a
// monotonic `revision` plus a `markSaved` that only clears `dirty` when the
// write that landed was for the current revision, so an edit made while a save
// was in flight is never silently dropped.

/** The persisted shape the builder loads from / re-syncs to. */
export interface LoadedShowcase {
  title: string;
  write_up: string;
  /** The Job photo ids in chosen gallery order. */
  photo_ids: string[];
}

/** The fields the builder edits, plus the dirty flag that drives auto-save. */
export interface ShowcaseBuilderState {
  title: string;
  writeUp: string;
  /** Chosen Job photo ids, in gallery order. */
  photoIds: string[];
  /** True once an edit has happened that has not yet been persisted. */
  dirty: boolean;
  /**
   * Monotonic counter bumped on every edit. Auto-save captures the revision it
   * is writing and passes it back via `markSaved`; dirty is only cleared if no
   * newer edit landed while the write was in flight.
   */
  revision: number;
}

export type ShowcaseBuilderAction =
  | { type: "setTitle"; title: string }
  | { type: "setWriteUp"; writeUp: string }
  | { type: "addPhoto"; photoId: string }
  | { type: "removePhoto"; photoId: string }
  | { type: "reorderPhoto"; from: number; to: number }
  | { type: "markSaved"; revision: number };

/**
 * Seed builder state from a loaded (already-persisted) showcase row. A freshly
 * loaded showcase is not dirty — nothing has changed since it came off disk.
 */
export function initShowcaseBuilderState(
  showcase: LoadedShowcase,
): ShowcaseBuilderState {
  return {
    title: showcase.title,
    writeUp: showcase.write_up,
    photoIds: [...showcase.photo_ids],
    dirty: false,
    revision: 0,
  };
}

export function showcaseBuilderReducer(
  state: ShowcaseBuilderState,
  action: ShowcaseBuilderAction,
): ShowcaseBuilderState {
  switch (action.type) {
    case "setTitle":
      return {
        ...state,
        title: action.title,
        dirty: true,
        revision: state.revision + 1,
      };
    case "setWriteUp":
      return {
        ...state,
        writeUp: action.writeUp,
        dirty: true,
        revision: state.revision + 1,
      };
    case "addPhoto":
      // Add a photo to the gallery, appended in selection order. A photo lives
      // at most once in a Showcase, so re-adding one already chosen is a no-op:
      // leave state untouched (preserve identity, don't dirty, don't reorder).
      if (state.photoIds.includes(action.photoId)) return state;
      return {
        ...state,
        photoIds: [...state.photoIds, action.photoId],
        dirty: true,
        revision: state.revision + 1,
      };
    case "removePhoto": {
      // Drop a photo from the gallery. A no-op (photo not chosen) leaves state
      // untouched so it does not needlessly mark the Showcase dirty.
      if (!state.photoIds.includes(action.photoId)) return state;
      return {
        ...state,
        photoIds: state.photoIds.filter((id) => id !== action.photoId),
        dirty: true,
        revision: state.revision + 1,
      };
    }
    case "reorderPhoto": {
      // Move a photo to a new position, matching dnd-kit's arrayMove: the
      // dragged photo lands at the target index and the others shift to fill the
      // gap. The persisted photo_ids order *is* the gallery order, so this is
      // the user's lever on how the Showcase reads. Out-of-range or no-move
      // dispatches leave state untouched.
      const { from, to } = action;
      const count = state.photoIds.length;
      if (from < 0 || from >= count || to < 0 || to >= count) return state;
      if (from === to) return state;
      const photoIds = [...state.photoIds];
      const [moved] = photoIds.splice(from, 1);
      photoIds.splice(to, 0, moved);
      return {
        ...state,
        photoIds,
        dirty: true,
        revision: state.revision + 1,
      };
    }
    case "markSaved":
      // Only clear dirty if the write that just landed was for the *current*
      // revision. If an edit happened while the save was in flight, the state is
      // newer than what was persisted, so it stays dirty and auto-save fires
      // again for the newer value.
      if (action.revision !== state.revision) return state;
      return { ...state, dirty: false };
    default:
      return state;
  }
}
