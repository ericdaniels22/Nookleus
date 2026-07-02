import { describe, expect, it } from "vitest";

import { buildSenderRule, shouldRefile } from "./sender-rule";

describe("buildSenderRule", () => {
  it("builds an org-scoped, active sender_address rule from a raw from-address", () => {
    const rule = buildSenderRule("  Jane.Adjuster@StateFarm.com  ", "general", "org-1");

    expect(rule).toEqual({
      match_type: "sender_address",
      match_value: "jane.adjuster@statefarm.com",
      category: "general",
      organization_id: "org-1",
      is_active: true,
    });
  });
});

describe("shouldRefile", () => {
  it("re-files an unlocked email that sits in a different bucket", () => {
    expect(
      shouldRefile({ category: "general", category_locked: false }, "promotions"),
    ).toBe(true);
  });

  it("never touches a category_locked email — a manual move always wins", () => {
    expect(
      shouldRefile({ category: "general", category_locked: true }, "promotions"),
    ).toBe(false);
  });

  it("leaves an email already in the target bucket alone", () => {
    expect(
      shouldRefile({ category: "promotions", category_locked: false }, "promotions"),
    ).toBe(false);
  });
});
