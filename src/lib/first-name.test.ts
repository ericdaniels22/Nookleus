import { describe, expect, it } from "vitest";

import { getFirstName } from "./first-name";

describe("getFirstName", () => {
  it("returns the first segment of a two-token name", () => {
    expect(getFirstName("Eric Daniels")).toBe("Eric");
  });

  it("returns only the first token for three-or-more-token names (known limitation)", () => {
    expect(getFirstName("Ana Maria Garcia")).toBe("Ana");
  });

  it("returns a single-token name unchanged", () => {
    expect(getFirstName("Eric")).toBe("Eric");
  });

  it("returns an empty string for an empty input", () => {
    expect(getFirstName("")).toBe("");
  });

  it("returns an empty string for null", () => {
    expect(getFirstName(null)).toBe("");
  });

  it("returns an empty string for undefined", () => {
    expect(getFirstName(undefined)).toBe("");
  });

  it("trims surrounding whitespace before splitting", () => {
    expect(getFirstName("  Eric  ")).toBe("Eric");
  });
});
