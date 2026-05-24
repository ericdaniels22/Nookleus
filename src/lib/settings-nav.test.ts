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
