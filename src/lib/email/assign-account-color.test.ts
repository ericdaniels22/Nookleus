import { describe, it, expect } from "vitest";
import { assignAccountColor } from "./assign-account-color";

describe("assignAccountColor", () => {
  it("returns Nookleus green for the first account in an org", () => {
    expect(assignAccountColor("org-1", [])).toBe("#0F6E56");
  });

  it("skips an in-use palette color and returns the next one", () => {
    expect(assignAccountColor("org-1", ["#0F6E56"])).toBe("#2563EB");
  });

  it("honors an explicit override even when palette would pick otherwise", () => {
    expect(assignAccountColor("org-1", [], "#FF00AA")).toBe("#FF00AA");
    expect(assignAccountColor("org-1", ["#0F6E56"], "#0F6E56")).toBe("#0F6E56");
  });

  it("returns gray fallback when every palette color is in use", () => {
    const allUsed = ["#0F6E56", "#2563EB", "#D97706", "#7C3AED", "#E11D48"];
    expect(assignAccountColor("org-1", allUsed)).toBe("#6B7280");
  });

  it("tolerates duplicates in existingColors", () => {
    // Same color repeated across accounts is allowed; this layer
    // doesn't enforce uniqueness, it just picks the next free slot.
    expect(assignAccountColor("org-1", ["#0F6E56", "#0F6E56"])).toBe("#2563EB");
  });
});
