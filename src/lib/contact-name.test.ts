import { describe, expect, it } from "vitest";

import { joinName, splitName } from "./contact-name";

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

// joinName is the contract the migration's full_name backfill mirrors: the
// backfill UPDATE computes full_name from existing first_name/last_name with
// the SQL equivalent of this function. These cases double as the backfill
// correctness check over representative existing contact data.
describe("joinName", () => {
  it("joins first and last with a single space", () => {
    expect(joinName("John", "Doe")).toBe("John Doe");
  });

  it("backfills a single-token (adjuster-style) name with an empty last name", () => {
    expect(joinName("Mary Jane Watson", "")).toBe("Mary Jane Watson");
  });

  it("omits a missing last name without leaving a trailing space", () => {
    expect(joinName("Cher", "")).toBe("Cher");
    expect(joinName("Cher", null)).toBe("Cher");
  });

  it("omits a missing first name without leaving a leading space", () => {
    expect(joinName("", "Doe")).toBe("Doe");
    expect(joinName(null, "Doe")).toBe("Doe");
  });

  it("returns an empty string when both parts are missing", () => {
    expect(joinName(null, null)).toBe("");
    expect(joinName("", "")).toBe("");
  });

  it("trims each part before joining", () => {
    expect(joinName("  John ", " Doe ")).toBe("John Doe");
  });
});
