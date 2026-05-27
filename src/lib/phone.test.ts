import { describe, expect, it } from "vitest";

import {
  findContactByPhone,
  formatPhoneNumber,
  isValidUSPhone,
  normalizePhoneToE164,
  phoneMatchesQuery,
} from "./phone";

describe("formatPhoneNumber", () => {
  it("returns an empty string for empty input", () => {
    expect(formatPhoneNumber("")).toBe("");
  });

  it("returns an empty string when the input has no digits", () => {
    expect(formatPhoneNumber("abc-()")).toBe("");
  });

  it("wraps one-to-three digits in an opening paren", () => {
    expect(formatPhoneNumber("5")).toBe("(5");
    expect(formatPhoneNumber("555")).toBe("(555");
  });

  it("adds the closing paren once the area code is complete", () => {
    expect(formatPhoneNumber("5551")).toBe("(555) 1");
    expect(formatPhoneNumber("555123")).toBe("(555) 123");
  });

  it("adds the hyphen for the final block", () => {
    expect(formatPhoneNumber("5551234")).toBe("(555) 123-4");
    expect(formatPhoneNumber("5551234567")).toBe("(555) 123-4567");
  });

  it("is stable on an already-formatted value", () => {
    expect(formatPhoneNumber("(555) 123-4567")).toBe("(555) 123-4567");
  });

  it("ignores separator characters in the input", () => {
    expect(formatPhoneNumber("555.123.4567")).toBe("(555) 123-4567");
  });

  it("drops a leading US country code", () => {
    expect(formatPhoneNumber("15551234567")).toBe("(555) 123-4567");
    expect(formatPhoneNumber("+1 555 123 4567")).toBe("(555) 123-4567");
  });

  it("formats a stored E.164 value for display", () => {
    expect(formatPhoneNumber("+15551234567")).toBe("(555) 123-4567");
  });

  it("ignores digits typed past the tenth", () => {
    expect(formatPhoneNumber("55512345670000")).toBe("(555) 123-4567");
  });
});

describe("normalizePhoneToE164", () => {
  it("returns null for empty or blank input", () => {
    expect(normalizePhoneToE164("")).toBeNull();
    expect(normalizePhoneToE164("   ")).toBeNull();
  });

  it("normalizes a bare 10-digit number", () => {
    expect(normalizePhoneToE164("5551234567")).toBe("+15551234567");
  });

  it("normalizes a formatted display string", () => {
    expect(normalizePhoneToE164("(555) 123-4567")).toBe("+15551234567");
  });

  it("normalizes an 11-digit number with a leading country code", () => {
    expect(normalizePhoneToE164("1 (555) 123-4567")).toBe("+15551234567");
  });

  it("is idempotent on an already-canonical value", () => {
    expect(normalizePhoneToE164("+15551234567")).toBe("+15551234567");
  });

  it("returns null for too-few digits", () => {
    expect(normalizePhoneToE164("555123")).toBeNull();
  });

  it("returns null for too-many digits", () => {
    expect(normalizePhoneToE164("5551234567890")).toBeNull();
  });

  it("returns null for an 11-digit number that is not country-code-prefixed", () => {
    expect(normalizePhoneToE164("25551234567")).toBeNull();
  });
});

describe("phoneMatchesQuery", () => {
  it("matches a stored E.164 number against a formatted query", () => {
    expect(phoneMatchesQuery("+15551234567", "(555) 123-4567")).toBe(true);
  });

  it("does not match when the query has no digits", () => {
    expect(phoneMatchesQuery("+15551234567", "john")).toBe(false);
  });

  it("matches a raw-digit query", () => {
    expect(phoneMatchesQuery("+15551234567", "5551234567")).toBe(true);
  });

  it("matches a partial query against the area code or any digit run", () => {
    expect(phoneMatchesQuery("+15551234567", "555")).toBe(true);
    expect(phoneMatchesQuery("+15551234567", "234")).toBe(true);
  });

  it("does not match when the query digits are absent from the number", () => {
    expect(phoneMatchesQuery("+15551234567", "999")).toBe(false);
  });

  it("does not match a null or undefined stored phone", () => {
    expect(phoneMatchesQuery(null, "555")).toBe(false);
    expect(phoneMatchesQuery(undefined, "555")).toBe(false);
  });

  it("matches across formats — a country-code query against a 10-digit stored value", () => {
    expect(phoneMatchesQuery("5551234567", "1 (555) 123-4567")).toBe(true);
  });
});

describe("findContactByPhone (PRD #304, slice 4 — outside-E.164 → Contact)", () => {
  // The inbound webhook gets a Twilio E.164 (`+15551234567`) and needs to
  // resolve it to one of the org's contacts whose stored phone may be in
  // any user-typed form (`(555) 123-4567`, `555-123-4567`, bare digits,
  // E.164, or null). The match is digits-equal on the canonical 10-digit
  // form — never substring (so the area code "555" doesn't match the
  // local "555" of a different number).

  it("returns the contact whose stored phone matches the E.164 input", () => {
    const alice = { id: "c-1", phone: "(555) 123-4567" };
    const bob = { id: "c-2", phone: "(555) 987-6543" };

    expect(findContactByPhone([alice, bob], "+15551234567")).toEqual(alice);
  });

  it("returns null when no contact matches", () => {
    const alice = { id: "c-1", phone: "(555) 123-4567" };

    expect(findContactByPhone([alice], "+15559999999")).toBeNull();
  });

  it("returns null when the input is not a valid E.164 (defensive)", () => {
    const alice = { id: "c-1", phone: "(555) 123-4567" };

    expect(findContactByPhone([alice], "not-a-number")).toBeNull();
    expect(findContactByPhone([alice], "")).toBeNull();
  });

  it("skips contacts whose phone is null or empty", () => {
    const noPhone = { id: "c-1", phone: null };
    const empty = { id: "c-2", phone: "" };
    const match = { id: "c-3", phone: "+15551234567" };

    expect(findContactByPhone([noPhone, empty, match], "+15551234567"))
      .toEqual(match);
  });

  it("matches across stored formats — bare digits, E.164, formatted", () => {
    expect(
      findContactByPhone([{ id: "c-1", phone: "5551234567" }], "+15551234567"),
    ).toEqual({ id: "c-1", phone: "5551234567" });
    expect(
      findContactByPhone([{ id: "c-2", phone: "+15551234567" }], "+15551234567"),
    ).toEqual({ id: "c-2", phone: "+15551234567" });
    expect(
      findContactByPhone(
        [{ id: "c-3", phone: "555.123.4567" }],
        "+15551234567",
      ),
    ).toEqual({ id: "c-3", phone: "555.123.4567" });
  });

  it("does NOT do substring matching — a query for an area code should not match a local block", () => {
    // Stored "(555) 123-4567" must not match the input "+15125555000" just
    // because both have "555" somewhere. The match is digits-equal on the
    // 10-digit canonical, not substring.
    const c = { id: "c-1", phone: "(555) 123-4567" };
    expect(findContactByPhone([c], "+15125555000")).toBeNull();
  });

  it("returns the first match when multiple contacts share the same number", () => {
    // The data model permits duplicates (e.g., a homeowner and adjuster
    // with the same office line). The webhook routes to the first; future
    // slices may surface ambiguity in the UI.
    const a = { id: "c-1", phone: "+15551234567" };
    const b = { id: "c-2", phone: "5551234567" };

    expect(findContactByPhone([a, b], "+15551234567")).toEqual(a);
  });
});

describe("isValidUSPhone", () => {
  it("is true for a complete 10-digit number", () => {
    expect(isValidUSPhone("(555) 123-4567")).toBe(true);
  });

  it("is true for an E.164 value", () => {
    expect(isValidUSPhone("+15551234567")).toBe(true);
  });

  it("is false for empty input", () => {
    expect(isValidUSPhone("")).toBe(false);
  });

  it("is false for a partial number", () => {
    expect(isValidUSPhone("(555) 12")).toBe(false);
  });
});
