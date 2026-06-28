import { describe, it, expect } from "vitest";
import {
  AUTOMATIC_FONT_COLOR_SWATCH,
  fontColorControlModel,
} from "./font-color-control";

describe("fontColorControlModel", () => {
  it("reports no color and a neutral swatch when the text color is unset", () => {
    // The native <input type="color"> can't represent "no color" — it defaults
    // to #000000, so a stray click stamps pure black onto text that was meant to
    // stay the document default (issue #660). Surface "automatic" explicitly: the
    // swatch shows a neutral default, and isSet stays false so the UI can offer a
    // clear/automatic affordance instead of implying black is already applied.
    const model = fontColorControlModel(undefined);
    expect(model.isSet).toBe(false);
    expect(model.value).toBe(AUTOMATIC_FONT_COLOR_SWATCH);
    expect(model.value).not.toBe("#000000");
  });

  it("reflects an explicitly set text color", () => {
    const model = fontColorControlModel("#ff0000");
    expect(model.isSet).toBe(true);
    expect(model.value).toBe("#ff0000");
  });
});
