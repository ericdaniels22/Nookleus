// Windowing state machine for the floating compose window (issue #638).
//
// The compose surface can be displayed three ways:
//   - "docked"     — the default corner-docked panel (full-screen sheet on mobile)
//   - "maximized"  — fills the screen
//   - "minimized"  — collapsed to a title strip
//
// Minimize is reversible: restoring returns to whichever expanded mode
// (docked or maximized) was showing before the collapse, so we remember it in
// `restoreMode`. Keeping this logic as a pure reducer lets the windowing
// behavior be unit-tested independently of the React component.

export type ComposeWindowMode = "docked" | "maximized" | "minimized";

/** The expanded modes we can restore to after un-minimizing. */
export type ComposeWindowRestoreMode = "docked" | "maximized";

export interface ComposeWindowState {
  mode: ComposeWindowMode;
  /** The expanded mode to return to when restoring from "minimized". */
  restoreMode: ComposeWindowRestoreMode;
}

export type ComposeWindowAction =
  | { type: "toggleMaximize" }
  | { type: "minimize" }
  | { type: "restore" }
  | { type: "reset" };

export const initialComposeWindowState: ComposeWindowState = {
  mode: "docked",
  restoreMode: "docked",
};

export function composeWindowReducer(
  state: ComposeWindowState,
  action: ComposeWindowAction,
): ComposeWindowState {
  switch (action.type) {
    case "toggleMaximize": {
      // From minimized, the maximize control expands back to the remembered mode.
      if (state.mode === "minimized") {
        return { mode: state.restoreMode, restoreMode: state.restoreMode };
      }
      const next: ComposeWindowRestoreMode =
        state.mode === "maximized" ? "docked" : "maximized";
      return { mode: next, restoreMode: next };
    }
    case "minimize": {
      if (state.mode === "minimized") return state;
      // state.mode is "docked" | "maximized" here — remember it for restore.
      return { mode: "minimized", restoreMode: state.mode };
    }
    case "restore": {
      if (state.mode !== "minimized") return state;
      return { mode: state.restoreMode, restoreMode: state.restoreMode };
    }
    case "reset":
      return initialComposeWindowState;
    default:
      return state;
  }
}

/** The maximize/restore-down title-bar control, or null when it should be hidden. */
export interface MaximizeControl {
  /** Tooltip / aria-label for the button. */
  label: string;
  /** true → show the "restore down" icon (currently maximized); false → "maximize". */
  showsRestore: boolean;
}

/**
 * Decide whether — and how — to show the maximize/restore-down control (#660).
 *
 * Two cases hide it entirely:
 *   - Mobile: the docked sheet already fills the screen, so maximize is a no-op.
 *   - Minimized: the restore/minimize button already expands the window; a second
 *     "Maximize" button there just mislabels the same restore action.
 */
export function maximizeControlFor(
  mode: ComposeWindowMode,
  { isMobile }: { isMobile: boolean },
): MaximizeControl | null {
  if (isMobile) return null;
  if (mode === "minimized") return null;
  if (mode === "maximized") return { label: "Restore down", showsRestore: true };
  return { label: "Maximize", showsRestore: false };
}
