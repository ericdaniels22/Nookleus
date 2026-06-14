import { describe, it, expect } from "vitest";
import {
  composeWindowReducer,
  initialComposeWindowState,
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
