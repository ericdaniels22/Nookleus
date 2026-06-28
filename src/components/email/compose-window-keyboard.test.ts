import { describe, it, expect } from "vitest";
import {
  initialFocusTarget,
  composeEscapeIntent,
} from "./compose-window-keyboard";

describe("initialFocusTarget", () => {
  it("focuses the body when replying or forwarding (recipients already known)", () => {
    expect(
      initialFocusTarget({ mode: "reply", hasPrefilledRecipient: true }),
    ).toBe("body");
    expect(
      initialFocusTarget({ mode: "forward", hasPrefilledRecipient: false }),
    ).toBe("body");
  });

  it("focuses the first field (To) for a fresh compose with no recipient", () => {
    expect(
      initialFocusTarget({ mode: "compose", hasPrefilledRecipient: false }),
    ).toBe("to");
  });

  it("focuses the body for a compose that was opened with a recipient prefilled", () => {
    expect(
      initialFocusTarget({ mode: "compose", hasPrefilledRecipient: true }),
    ).toBe("body");
  });
});

describe("composeEscapeIntent", () => {
  it("closes the window when no inner overlay is open", () => {
    expect(composeEscapeIntent({ anyOverlayOpen: false })).toBe("close-window");
  });

  it("dismisses the open overlay first, leaving the window open", () => {
    // A picker (contact / signature / template) is open and rendered inline, so
    // its Escape bubbles up. Escape should peel that off before closing the whole
    // window — matching the layered dismissal the Base UI Dialog used to give us.
    expect(composeEscapeIntent({ anyOverlayOpen: true })).toBe("dismiss-overlay");
  });
});
