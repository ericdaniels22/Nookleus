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

// #233 — guard the canonical settings nav shape after Slice 7. A single
// "Company" entry replaces "Company Profile" and now owns Appearance and
// PDF Presets as tabs inside /settings/company. The old top-level entries
// for those two pages are gone.
describe("settingsNavItems (Slice 7 — Company + Branding merge)", () => {
  it("has a single Company entry pointing at /settings/company", () => {
    const companyEntries = settingsNavItems.filter(
      (item) => item.href === "/settings/company",
    );
    expect(companyEntries).toHaveLength(1);
    expect(companyEntries[0].label).toBe("Company");
  });

  it("no longer has top-level Appearance or PDF Presets entries", () => {
    const appearance = settingsNavItems.find(
      (item) => item.href === "/settings/appearance",
    );
    const pdfPresets = settingsNavItems.find(
      (item) => item.href === "/settings/pdf-presets",
    );
    expect(appearance).toBeUndefined();
    expect(pdfPresets).toBeUndefined();
  });

  it("no longer has the legacy 'Company Profile' label", () => {
    const labels = settingsNavItems.map((item) => item.label);
    expect(labels).not.toContain("Company Profile");
  });
});
