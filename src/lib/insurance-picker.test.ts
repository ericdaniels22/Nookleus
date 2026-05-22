import { describe, expect, it } from "vitest";

import { isValidClaimsEmail, shouldOfferCreate } from "./insurance-picker";

describe("shouldOfferCreate", () => {
  it("is false for an empty query — there is nothing to create", () => {
    expect(shouldOfferCreate("", ["State Farm"])).toBe(false);
  });

  it("is false for a query whose name already exists, regardless of case", () => {
    expect(shouldOfferCreate("state farm", ["State Farm"])).toBe(false);
    expect(shouldOfferCreate("  STATE FARM  ", ["State Farm"])).toBe(false);
  });

  it("is true for a near-but-not-exact match — a new company is plausible", () => {
    expect(shouldOfferCreate("State", ["State Farm"])).toBe(true);
  });

  it("is true when no existing insurance company matches the query", () => {
    expect(shouldOfferCreate("Geico", ["State Farm", "Allstate"])).toBe(true);
  });
});

describe("isValidClaimsEmail", () => {
  it("is true for a well-formed email address", () => {
    expect(isValidClaimsEmail("claims@statefarm.com")).toBe(true);
  });

  it("is false for a malformed address", () => {
    expect(isValidClaimsEmail("not-an-email")).toBe(false);
    expect(isValidClaimsEmail("claims@statefarm")).toBe(false);
    expect(isValidClaimsEmail("claims @statefarm.com")).toBe(false);
  });

  it("is true for an empty string — the claims email is optional", () => {
    expect(isValidClaimsEmail("")).toBe(true);
    expect(isValidClaimsEmail("   ")).toBe(true);
  });
});
