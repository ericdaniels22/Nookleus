import { describe, expect, it } from "vitest";

import { splitName } from "./contact-name";

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
