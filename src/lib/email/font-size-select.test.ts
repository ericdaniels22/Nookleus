import { describe, it, expect } from "vitest";
import { fontSizeSelectModel } from "./font-size-select";

const PRESETS = [
  { label: "Small", value: "12px" },
  { label: "Normal", value: "16px" },
  { label: "Large", value: "20px" },
  { label: "Huge", value: "28px" },
];

describe("fontSizeSelectModel", () => {
  it("uses the empty value (no preset added) when no font size is set", () => {
    const model = fontSizeSelectModel(undefined, PRESETS);
    expect(model.value).toBe("");
    expect(model.options).toEqual(PRESETS);
  });

  it("selects a matching preset without adding any option", () => {
    const model = fontSizeSelectModel("16px", PRESETS);
    expect(model.value).toBe("16px");
    expect(model.options).toEqual(PRESETS);
  });

  it("surfaces a non-preset size as its own option so the control can't desync", () => {
    // A size set elsewhere (pasted HTML, another editor) isn't in the preset
    // list. Without a representable option the controlled <select> would snap its
    // display to a preset and a later change would silently rewrite the real
    // size (issue #660). Adding the size as its own option keeps display honest.
    const model = fontSizeSelectModel("14px", PRESETS);
    expect(model.value).toBe("14px");
    expect(model.options.some((o) => o.value === "14px")).toBe(true);
    // The presets are preserved and the custom size is appended, not replacing.
    expect(model.options.slice(0, PRESETS.length)).toEqual(PRESETS);
  });
});
