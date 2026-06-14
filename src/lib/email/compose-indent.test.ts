import { describe, it, expect } from "vitest";
import {
  nextIndentLevel,
  MAX_INDENT_LEVEL,
  indentToMarginPx,
  INDENT_STEP_PX,
} from "./compose-indent";

describe("nextIndentLevel", () => {
  it("raises the level by one step when indenting", () => {
    expect(nextIndentLevel(0, "indent")).toBe(1);
  });

  it("lowers the level by one step when outdenting", () => {
    expect(nextIndentLevel(3, "outdent")).toBe(2);
  });

  it("clamps at zero — outdenting an unindented block stays at zero", () => {
    expect(nextIndentLevel(0, "outdent")).toBe(0);
  });

  it("clamps at the maximum — indenting past the cap stays at the cap", () => {
    expect(nextIndentLevel(MAX_INDENT_LEVEL, "indent")).toBe(MAX_INDENT_LEVEL);
  });

  it("normalizes a non-finite current level to zero before stepping", () => {
    expect(nextIndentLevel(Number.NaN, "indent")).toBe(1);
  });
});

describe("indentToMarginPx", () => {
  it("renders no margin at level zero", () => {
    expect(indentToMarginPx(0)).toBe(0);
  });

  it("renders one indent step of left margin per level", () => {
    expect(indentToMarginPx(3)).toBe(3 * INDENT_STEP_PX);
  });
});
