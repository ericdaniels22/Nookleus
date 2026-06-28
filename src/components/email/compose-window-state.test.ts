import { describe, it, expect } from "vitest";
import {
  composeWindowReducer,
  initialComposeWindowState,
  maximizeControlFor,
} from "./compose-window-state";

describe("composeWindowReducer", () => {
  it("maximizes from the docked state", () => {
    const next = composeWindowReducer(initialComposeWindowState, {
      type: "toggleMaximize",
    });
    expect(next.mode).toBe("maximized");
  });

  it("toggles back to docked from maximized", () => {
    const maximized = composeWindowReducer(initialComposeWindowState, {
      type: "toggleMaximize",
    });
    const restored = composeWindowReducer(maximized, { type: "toggleMaximize" });
    expect(restored.mode).toBe("docked");
  });

  it("minimizes the docked window and restores back to docked", () => {
    const minimized = composeWindowReducer(initialComposeWindowState, {
      type: "minimize",
    });
    expect(minimized.mode).toBe("minimized");
    const restored = composeWindowReducer(minimized, { type: "restore" });
    expect(restored.mode).toBe("docked");
  });

  it("remembers maximized when minimizing, and restores back to maximized", () => {
    const maximized = composeWindowReducer(initialComposeWindowState, {
      type: "toggleMaximize",
    });
    const minimized = composeWindowReducer(maximized, { type: "minimize" });
    expect(minimized.mode).toBe("minimized");
    const restored = composeWindowReducer(minimized, { type: "restore" });
    expect(restored.mode).toBe("maximized");
  });

  it("expands a minimized window via the maximize control to its prior mode", () => {
    const maximized = composeWindowReducer(initialComposeWindowState, {
      type: "toggleMaximize",
    });
    const minimized = composeWindowReducer(maximized, { type: "minimize" });
    const expanded = composeWindowReducer(minimized, { type: "toggleMaximize" });
    expect(expanded.mode).toBe("maximized");
  });

  it("treats minimize as idempotent", () => {
    const once = composeWindowReducer(initialComposeWindowState, {
      type: "minimize",
    });
    const twice = composeWindowReducer(once, { type: "minimize" });
    expect(twice).toEqual(once);
  });

  it("ignores restore when not minimized", () => {
    const docked = composeWindowReducer(initialComposeWindowState, {
      type: "restore",
    });
    expect(docked).toBe(initialComposeWindowState);
  });

  it("resets back to the docked default", () => {
    const maximized = composeWindowReducer(initialComposeWindowState, {
      type: "toggleMaximize",
    });
    const reset = composeWindowReducer(maximized, { type: "reset" });
    expect(reset).toEqual(initialComposeWindowState);
  });
});

describe("maximizeControlFor", () => {
  it("offers Maximize from the docked desktop window", () => {
    expect(maximizeControlFor("docked", { isMobile: false })).toEqual({
      label: "Maximize",
      showsRestore: false,
    });
  });

  it("offers Restore down when the desktop window is maximized", () => {
    expect(maximizeControlFor("maximized", { isMobile: false })).toEqual({
      label: "Restore down",
      showsRestore: true,
    });
  });

  it("hides the control on mobile, where the docked sheet is already full-screen", () => {
    // Maximize is a no-op on a phone (docked === full-screen), so don't offer a
    // control that does nothing (issue #660).
    expect(maximizeControlFor("docked", { isMobile: true })).toBeNull();
    expect(maximizeControlFor("maximized", { isMobile: true })).toBeNull();
  });

  it("hides the control while minimized, where the restore button already expands", () => {
    // From minimized, toggleMaximize just restores — a second 'Maximize' button
    // mislabels the same action, so suppress it (issue #660).
    expect(maximizeControlFor("minimized", { isMobile: false })).toBeNull();
  });
});
