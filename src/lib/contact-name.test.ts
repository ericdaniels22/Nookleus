import { describe, expect, it } from "vitest";

import { initials, splitName } from "./contact-name";

describe("splitName", () => {
  it("returns empty parts for an empty string", () => {
    expect(splitName("")).toEqual({ givenName: "", familyName: "" });
  });

  it("returns empty parts for whitespace-only input", () => {
    expect(splitName("   ")).toEqual({ givenName: "", familyName: "" });
  });

  it("puts a single token in the given name with an empty family name", () => {
    expect(splitName("Cher")).toEqual({ givenName: "Cher", familyName: "" });
  });

  it("splits two tokens on the space", () => {
    expect(splitName("John Doe")).toEqual({ givenName: "John", familyName: "Doe" });
  });

  it("splits three-or-more tokens on the last space", () => {
    expect(splitName("Mary Jane Watson")).toEqual({
      givenName: "Mary Jane",
      familyName: "Watson",
    });
  });

  it("trims leading and trailing whitespace", () => {
    expect(splitName("  John Doe  ")).toEqual({ givenName: "John", familyName: "Doe" });
  });

  it("collapses runs of internal whitespace", () => {
    expect(splitName("John   Doe")).toEqual({ givenName: "John", familyName: "Doe" });
  });
});

describe("initials", () => {
  it("takes the first letter of the first and last token, uppercased", () => {
    expect(initials("Jane Doe")).toBe("JD");
  });

  it("returns a single letter for a one-token name", () => {
    expect(initials("Madonna")).toBe("M");
  });

  it("falls back to '?' for an empty or whitespace-only name", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });

  it("uses only the first and last token, normalizing case and whitespace", () => {
    expect(initials("mary jane watson")).toBe("MW");
    expect(initials("  Jane   Doe  ")).toBe("JD");
  });
});
