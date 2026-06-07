// Issue #466 — Scroll-spy active-page sync, slice #4 of the in-app PDF viewer
// (#462). The pure "page-picker brain": which page the viewer considers active,
// and how that moves. It has no React in it on purpose — the viewer wraps
// `pagePickerReducer` in `useReducer`, and scroll-spy, thumbnail clicks, and
// keyboard nav all funnel through the same actions so they can never disagree on
// the active page. Keeping the transitions here makes them trivially testable
// (dispatch an action, assert the next state) without rendering pdf.js.

/** Which page is active and how many pages the document has. */
export interface PagePickerState {
  /** Page count once the document reports it; 0 before it has loaded. */
  numPages: number;
  /** The page the picker currently considers active, 1-based. */
  activePage: number;
}

export type PagePickerAction =
  | { type: "setNumPages"; numPages: number }
  | { type: "setActivePage"; page: number }
  | { type: "next" }
  | { type: "prev" };

/** Before the document loads there is no count yet, and page 1 is active. */
export const initialPagePickerState: PagePickerState = {
  numPages: 0,
  activePage: 1,
};

/**
 * Pin a page into the valid `[1, numPages]` range. Before the count is known
 * (`numPages < 1`) there is no range to land in, so every page resolves to the
 * first — the picker can never point past a page that has not been reported yet.
 */
function clampPage(page: number, numPages: number): number {
  if (numPages < 1) return 1;
  return Math.min(numPages, Math.max(1, page));
}

export function pagePickerReducer(
  state: PagePickerState,
  action: PagePickerAction,
): PagePickerState {
  switch (action.type) {
    case "setNumPages": {
      // A reload can report a different (often smaller) count, so re-clamp the
      // active page against the new range — it must never point past the end.
      const numPages = Math.max(0, Math.floor(action.numPages));
      return { numPages, activePage: clampPage(state.activePage, numPages) };
    }
    case "setActivePage":
      return { ...state, activePage: clampPage(action.page, state.numPages) };
    case "next":
      return {
        ...state,
        activePage: clampPage(state.activePage + 1, state.numPages),
      };
    case "prev":
      return {
        ...state,
        activePage: clampPage(state.activePage - 1, state.numPages),
      };
  }
}
