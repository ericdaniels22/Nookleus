// PRD #304 — Nookleus Phone. Slice 2 (#306).
//
// Pins the role-default permission grants for `view_phone` against the table
// in PRD #304's Implementation Decisions § Permission:
//
//   | Role        | Default |
//   | ----------- | ------- |
//   | Admin       | ON      |
//   | Crew Lead   | ON      |
//   | Crew Member | OFF     |
//
// `ROLE_DEFAULTS` is the application-layer source of truth that
// `POST /api/settings/users` reads when seeding a new member's grants. The
// SQL function `set_default_permissions` mirrors this table at the database
// layer; the migration that ships with this slice keeps the two in sync.
//
// Admin's entry is `PERMISSION_KEYS` rather than an enumerated list — admins
// auto-pass every rule regardless of grants — so the admin assertion goes
// through the catalog.

import { describe, it, expect } from "vitest";
import { ROLE_DEFAULTS } from "./role-defaults";
import { PERMISSION_CATALOG } from "./permission-keys";

describe("ROLE_DEFAULTS — view_phone defaults (PRD #304)", () => {
  it("includes view_phone in admin's defaults (admins get every catalog key)", () => {
    expect(ROLE_DEFAULTS.admin).toContain("view_phone");
  });

  it("includes view_phone in crew_lead's defaults", () => {
    expect(ROLE_DEFAULTS.crew_lead).toContain("view_phone");
  });

  it("excludes view_phone from crew_member's defaults", () => {
    expect(ROLE_DEFAULTS.crew_member).not.toContain("view_phone");
  });

  it("excludes view_phone from custom (the empty default)", () => {
    expect(ROLE_DEFAULTS.custom).not.toContain("view_phone");
  });

  it("registers view_phone in the permission catalog under the Phone group", () => {
    const entry = PERMISSION_CATALOG.find((p) => p.key === "view_phone");
    expect(entry).toBeDefined();
    expect(entry?.group).toBe("Phone");
  });
});
