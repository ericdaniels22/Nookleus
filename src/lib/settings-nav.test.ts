import { describe, it, expect } from "vitest";
import { settingsNavItems } from "./settings-nav";

// #228 — settings nav has a single "People" entry covering both
// /settings/users and /settings/notifications (now tabs inside
// /settings/people). The two old standalone entries must be gone so
// the sidebar and mobile dropdown don't show stale routes.

describe("settingsNavItems — People consolidation (#228)", () => {
  const hrefs = settingsNavItems.map((i) => i.href);

  it("includes a People entry pointing at /settings/people", () => {
    const people = settingsNavItems.find((i) => i.href === "/settings/people");
    expect(people).toBeDefined();
    expect(people?.label).toBe("People");
  });

  it("no longer lists the old /settings/users entry", () => {
    expect(hrefs).not.toContain("/settings/users");
  });

  it("no longer lists the old /settings/notifications entry", () => {
    expect(hrefs).not.toContain("/settings/notifications");
  });
});

// #230 — Slice 4 of the Settings redesign collapses Vendors, Expense
// Categories, Accounting, and Stripe Payments into a single Money entry.
// This test pins the navigation contract: one Money entry pointing at the
// new combined route, and the four old entries are gone.

describe("settingsNavItems — Money section (slice 4)", () => {
  it("includes a Money entry pointing at /settings/money", () => {
    const money = settingsNavItems.find((i) => i.href === "/settings/money");
    expect(money).toBeDefined();
    expect(money?.label).toBe("Money");
  });

  it("no longer lists the four pre-redesign entries", () => {
    const stale = settingsNavItems.filter((i) =>
      ["/settings/vendors", "/settings/expense-categories", "/settings/accounting", "/settings/stripe"].includes(
        i.href,
      ),
    );
    expect(stale).toEqual([]);
  });
});

// #234 — Slice 8 collapses the misleadingly-named "Contracts" (which
// configured the contract email, not contracts themselves) and the
// equally misleadingly-named "Outgoing Emails" (which configured only
// the payment-link email) into a single honest "Outgoing Emails" entry
// pointing at the new combined /settings/outgoing section.

describe("settingsNavItems — Outgoing Emails section (slice 8)", () => {
  const hrefs = settingsNavItems.map((i) => i.href);

  it("includes an Outgoing Emails entry pointing at /settings/outgoing", () => {
    const outgoing = settingsNavItems.find(
      (i) => i.href === "/settings/outgoing",
    );
    expect(outgoing).toBeDefined();
    expect(outgoing?.label).toBe("Outgoing Emails");
  });

  it("no longer lists the misleadingly-named /settings/contracts entry", () => {
    expect(hrefs).not.toContain("/settings/contracts");
  });

  it("no longer lists the misleadingly-named /settings/payments entry", () => {
    expect(hrefs).not.toContain("/settings/payments");
  });
});
