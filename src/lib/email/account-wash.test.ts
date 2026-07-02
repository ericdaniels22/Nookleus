import { describe, it, expect } from "vitest";
import { accountRowWash } from "./account-wash";

// The mixed All-Inboxes list washes each row in its Email account's color
// (#955). Account colors are stored as hex (see assign-account-color.ts); the
// wash softens that hex into a low-alpha rgba so a saturated account color can
// never overpower the dark row. Kept as a pure helper so the alpha is defined
// once and the component test can assert an exact, jsdom-parseable value.
describe("accountRowWash", () => {
  it("softens a 6-digit hex into a low-alpha rgba wash", () => {
    expect(accountRowWash("#2563EB")).toBe("rgba(37, 99, 235, 0.1)");
  });

  it("accepts lowercase and 3-digit shorthand hex", () => {
    expect(accountRowWash("#abc")).toBe("rgba(170, 187, 204, 0.1)");
  });

  it("returns undefined when there is no color to wash with", () => {
    expect(accountRowWash(undefined)).toBeUndefined();
    expect(accountRowWash(null)).toBeUndefined();
    expect(accountRowWash("")).toBeUndefined();
  });

  it("returns undefined for a non-hex color rather than emitting broken css", () => {
    expect(accountRowWash("rebeccapurple")).toBeUndefined();
    expect(accountRowWash("#12")).toBeUndefined();
  });
});
