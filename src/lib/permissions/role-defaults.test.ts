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

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

// issue #701 (parent epic #699) — per-Job timesheets.
//
// Pins the role-default grants for `track_time`, the permission that gates
// clocking in / out of a Job:
//
//   | Role        | Default |
//   | ----------- | ------- |
//   | Admin       | ON      |
//   | Crew Lead   | ON      |
//   | Crew Member | ON      |   <- unlike view_phone: workers clock themselves in
//   | Custom      | OFF     |
//
// Crew Member is ON here because tracking time on a Job is core crew work —
// the whole point of the feature is the people doing the labor recording it.
// `custom` stays empty (admins hand-pick). The SQL `set_default_permissions`
// mirrors this; the migration shipping with #701 keeps the two in sync.

describe("ROLE_DEFAULTS — track_time defaults (#701)", () => {
  it("includes track_time in admin's defaults (admins get every catalog key)", () => {
    expect(ROLE_DEFAULTS.admin).toContain("track_time");
  });

  it("includes track_time in crew_lead's defaults", () => {
    expect(ROLE_DEFAULTS.crew_lead).toContain("track_time");
  });

  it("includes track_time in crew_member's defaults (workers clock themselves in)", () => {
    expect(ROLE_DEFAULTS.crew_member).toContain("track_time");
  });

  it("excludes track_time from custom (the empty default)", () => {
    expect(ROLE_DEFAULTS.custom).not.toContain("track_time");
  });

  it("registers track_time in the permission catalog under the Time group", () => {
    const entry = PERMISSION_CATALOG.find((p) => p.key === "track_time");
    expect(entry).toBeDefined();
    expect(entry?.group).toBe("Time");
  });
});

// issue #706 (parent epic #699) — Timesheet Corrections & needs-attention.
//
// Pins the role-default grants for `manage_timesheets`, the NEW permission that
// gates correcting a recorded session, hand-entry, and the lead needs-attention
// surface (CONTEXT.md "Correction": leads/admins only):
//
//   | Role        | Default |
//   | ----------- | ------- |
//   | Admin       | ON      |
//   | Crew Lead   | ON      |
//   | Crew Member | OFF     |   <- track_time only; can never type or edit a time
//   | Custom      | OFF     |
//
// Unlike track_time (crew_member ON, because workers self-clock), a Correction
// is a lead/admin power: a crew_member with track_time can clock in/out but can
// never edit a recorded session. The SQL `set_default_permissions` + the
// migration-706 backfill mirror this table; the parity test below reads the
// migration file and asserts the SQL grants manage_timesheets to exactly the
// roles the TS defaults do.

const MANAGE_TIMESHEETS = "manage_timesheets";
const TS_ROLES = ["admin", "crew_lead", "crew_member", "custom"] as const;
const EXPECTED_GRANT: Record<(typeof TS_ROLES)[number], boolean> = {
  admin: true,
  crew_lead: true,
  crew_member: false,
  custom: false,
};

describe("ROLE_DEFAULTS — manage_timesheets defaults (#706)", () => {
  it.each(TS_ROLES)("role %s has the pinned manage_timesheets default", (role) => {
    const granted = (ROLE_DEFAULTS[role] as readonly string[]).includes(MANAGE_TIMESHEETS);
    expect(granted).toBe(EXPECTED_GRANT[role]);
  });

  it("registers manage_timesheets in the permission catalog under the Time group", () => {
    const entry = PERMISSION_CATALOG.find((p) => p.key === MANAGE_TIMESHEETS);
    expect(entry).toBeDefined();
    expect(entry?.group).toBe("Time");
  });

  it("the SQL migration grants manage_timesheets to exactly the TS-granted roles", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migration-706-timesheet-corrections.sql"),
      "utf8",
    );
    // The migration introduces ONLY manage_timesheets, so every backfill role
    // gate (`uo.role in (...)`) in it describes that key's grant. Parse them and
    // require each to equal the role set the TS defaults grant — the TS↔SQL
    // parity the PRD demands.
    const tsGranted = TS_ROLES.filter((r) =>
      (ROLE_DEFAULTS[r] as readonly string[]).includes(MANAGE_TIMESHEETS),
    )
      .slice()
      .sort();
    const gates = [...sql.matchAll(/uo\.role in \(([^)]*)\)/g)];
    expect(gates.length).toBeGreaterThan(0);
    for (const gate of gates) {
      const roles = gate[1]
        .split(",")
        .map((s) => s.trim().replace(/'/g, ""))
        .sort();
      expect(roles).toEqual(tsGranted);
    }
  });

  it("set_default_permissions grants manage_timesheets to exactly the TS-granted roles", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migration-706-timesheet-corrections.sql"),
      "utf8",
    );
    // The authoritative SQL default for a NEW member is set_default_permissions,
    // which dispatches a per-role array of granted keys. The backfill-gate parity
    // above only pins the one-time historical fix; this asserts the FORWARD
    // default the function applies on every re-seed. Parse the array literals it
    // dispatches on and require each role's manage_timesheets grant to match the
    // TS table — so a divergence in the function body (e.g. dropping the key from
    // lead_perms, or adding it to member_perms) fails here, not only in the
    // hand-run SQL smoke test.
    const permArray = (name: string): string[] => {
      const m = sql.match(
        new RegExp(`\\b${name}\\s+text\\[\\]\\s*:=\\s*array\\[([\\s\\S]*?)\\]`),
      );
      if (!m) throw new Error(`array ${name} not found in set_default_permissions`);
      return m[1]
        .split(",")
        .map((s) => s.trim().replace(/'/g, ""))
        .filter(Boolean);
    };
    const allPerms = permArray("all_perms"); // admin (admin_perms := all_perms)
    const leadPerms = permArray("lead_perms"); // crew_lead
    const memberPerms = permArray("member_perms"); // custom + any other role
    // crew_member = member_perms || array['track_time'] — it adds only track_time,
    // so its manage_timesheets grant equals member_perms'.
    const fnGrant: Record<(typeof TS_ROLES)[number], boolean> = {
      admin: allPerms.includes(MANAGE_TIMESHEETS),
      crew_lead: leadPerms.includes(MANAGE_TIMESHEETS),
      crew_member: memberPerms.includes(MANAGE_TIMESHEETS),
      custom: memberPerms.includes(MANAGE_TIMESHEETS),
    };
    expect(fnGrant).toEqual(EXPECTED_GRANT);
  });
});

// issue #705 (parent epic #699) — Presence ("On the clock now").
//
// Pins the role-default grants for `view_timesheets`, the NEW permission that
// gates the owner-dashboard org-wide "On the clock now" roll-up (who is on a
// session anywhere in the Org, with a live elapsed timer). Unlike `track_time`
// it is OFF for crew members — a worker clocks themselves in (track_time) but
// does not see the whole-Org roster of everyone on the clock:
//
//   | Role        | Default |
//   | ----------- | ------- |
//   | Admin       | ON      |
//   | Crew Lead   | ON      |
//   | Crew Member | OFF     |   <- still sees per-Job "On site now" (view_jobs)
//   | Custom      | OFF     |
//
// `custom` stays empty (admins hand-pick). The SQL `set_default_permissions`
// mirrors this; the migration shipping with #705 keeps the two in sync.

describe("ROLE_DEFAULTS — view_timesheets defaults (#705)", () => {
  it("includes view_timesheets in admin's defaults (admins get every catalog key)", () => {
    expect(ROLE_DEFAULTS.admin).toContain("view_timesheets");
  });

  it("includes view_timesheets in crew_lead's defaults", () => {
    expect(ROLE_DEFAULTS.crew_lead).toContain("view_timesheets");
  });

  it("excludes view_timesheets from crew_member's defaults (workers don't see the Org roll-up)", () => {
    expect(ROLE_DEFAULTS.crew_member).not.toContain("view_timesheets");
  });

  it("excludes view_timesheets from custom (the empty default)", () => {
    expect(ROLE_DEFAULTS.custom).not.toContain("view_timesheets");
  });

  it("registers view_timesheets in the permission catalog under the Time group", () => {
    const entry = PERMISSION_CATALOG.find((p) => p.key === "view_timesheets");
    expect(entry).toBeDefined();
    expect(entry?.group).toBe("Time");
  });
});
