import { describe, it, expect, vi, beforeEach } from "vitest";

// The dispatcher and writeNotification both build their Service client via
// `createServiceClient`. We mock only that, so the test drives the REAL
// fan-out logic (active members, submitter exclusion, org scoping) through a
// single in-memory table fake.
const { mockCreateServiceClient } = vi.hoisted(() => ({
  mockCreateServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: mockCreateServiceClient,
}));

import { generateKeyPairSync } from "crypto";
import type {
  ApnsConfig,
  ApnsRequest,
  ApnsResponse,
  ApnsTransport,
  SendDeps,
} from "@/lib/push/apple-sender";

import { dispatchNewIntakeNotifications } from "./dispatch-new-intake";

// ---------- minimal Supabase fake (finalize.test.ts idiom) ----------------
type Row = Record<string, unknown>;
interface FakeError {
  message: string;
}

function makeFake() {
  const tables: Record<string, Row[]> = {};
  const inserts: Record<string, Row[]> = {};
  const errors: Record<string, FakeError | null> = {};

  const match = (row: Row, filters: Row) =>
    Object.entries(filters).every(([k, v]) => row[k] === v);

  function selectBuilder(table: string) {
    const filters: Row = {};
    const inFilters: Record<string, unknown[]> = {};
    const matches = (r: Row) =>
      match(r, filters) &&
      Object.entries(inFilters).every(([col, vals]) => vals.includes(r[col]));
    const builder = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return builder;
      },
      in(col: string, vals: unknown[]) {
        inFilters[col] = vals;
        return builder;
      },
      async maybeSingle() {
        const err = errors[`${table}.select`];
        if (err) return { data: null, error: err };
        return {
          data: (tables[table] ?? []).find(matches) ?? null,
          error: null,
        };
      },
      then(resolve: (v: { data: unknown; error: FakeError | null }) => unknown) {
        const err = errors[`${table}.select`];
        if (err) return resolve({ data: null, error: err });
        return resolve({
          data: (tables[table] ?? []).filter(matches),
          error: null,
        });
      },
    };
    return builder;
  }

  // `.delete().in(col, vals)` — removes the matching rows and resolves like a
  // PostgREST delete. Used by the registry's dead-token prune.
  function deleteBuilder(table: string) {
    const inFilters: Record<string, unknown[]> = {};
    const builder = {
      in(col: string, vals: unknown[]) {
        inFilters[col] = vals;
        return builder;
      },
      then(resolve: (v: { data: unknown; error: FakeError | null }) => unknown) {
        const err = errors[`${table}.delete`];
        if (err) return resolve({ data: null, error: err });
        tables[table] = (tables[table] ?? []).filter(
          (r) => !Object.entries(inFilters).every(([col, vals]) => vals.includes(r[col])),
        );
        return resolve({ data: null, error: null });
      },
    };
    return builder;
  }

  const client = {
    from(table: string) {
      return {
        select() {
          return selectBuilder(table);
        },
        delete() {
          return deleteBuilder(table);
        },
        insert(payload: Row | Row[]) {
          const rows = Array.isArray(payload) ? payload : [payload];
          (inserts[table] ??= []).push(...rows);
          return {
            then(resolve: (v: { data: unknown; error: FakeError | null }) => unknown) {
              return resolve({ data: null, error: errors[`${table}.insert`] ?? null });
            },
          };
        },
      };
    },
  };

  return {
    client,
    seed(table: string, rows: Row[]) {
      (tables[table] ??= []).push(...rows);
    },
    setError(key: string, err: FakeError | null) {
      errors[key] = err;
    },
    inserts,
    // Current contents of a table (post-prune, etc.).
    tableRows: (table: string) => tables[table] ?? [],
  };
}

type Fake = ReturnType<typeof makeFake>;

/** Seed one Job + its Contact under org-1 (emergency by default). */
function seedJob(fake: Fake, overrides: Partial<Row> = {}) {
  fake.seed("jobs", [
    {
      id: "job-1",
      organization_id: "org-1",
      urgency: "emergency",
      damage_type: "Water damage",
      property_address: "123 Main St",
      contact_id: "c-1",
      ...overrides,
    },
  ]);
  fake.seed("contacts", [{ id: "c-1", full_name: "John Smith" }]);
}

/** A membership row carrying the embedded is_active profile write.ts reads. */
function member(userId: string, role: string, isActive: boolean, orgId = "org-1"): Row {
  return {
    user_id: userId,
    organization_id: orgId,
    role,
    user_profiles: { is_active: isActive },
  };
}

const notifs = (fake: Fake): Row[] => fake.inserts.notifications ?? [];

// ---------- push (APNs) test deps ------------------------------------------
// A throwaway EC P-256 key so the dispatcher drives the REAL Apple sender /
// signing path without the production .p8 secret (same idiom as
// apple-sender.test.ts). Only the host distinguishes prod from sandbox.
function testPushConfig(): ApnsConfig {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    keyId: "TESTKEY123",
    teamId: "TEAMID9999",
    bundleId: "com.example.app",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/**
 * SendDeps whose transport records every device token it is handed, so a test
 * can assert exactly which devices were buzzed. `respond` maps a token to its
 * APNs reply (default 200 OK) — override it to simulate dead/erroring tokens.
 */
function recordingPush(
  respond: (token: string) => ApnsResponse = () => ({ status: 200, apnsId: "ok" }),
) {
  const requests: ApnsRequest[] = [];
  const transport: ApnsTransport = async (req) => {
    requests.push(req);
    return respond(req.token);
  };
  const deps: SendDeps = { transport, config: testPushConfig(), now: 1_700_000_000 };
  return { deps, requests, tokens: () => requests.map((r) => r.token) };
}

let fake: Fake;
beforeEach(() => {
  vi.clearAllMocks();
  // The best-effort path logs to console.error; keep test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
  fake = makeFake();
  mockCreateServiceClient.mockReturnValue(fake.client);
});

describe("dispatchNewIntakeNotifications", () => {
  it("writes a new_job bell row for every active member except the submitter", async () => {
    seedJob(fake);
    fake.seed("user_organizations", [
      member("submitter", "admin", true),
      member("teammate-a", "crew_lead", true),
      member("teammate-b", "crew_member", true),
    ]);

    await dispatchNewIntakeNotifications({ jobId: "job-1", submitterUserId: "submitter" });

    const rows = notifs(fake);
    expect(rows.map((r) => r.user_id).sort()).toEqual(["teammate-a", "teammate-b"]);
    expect(rows.every((r) => r.type === "new_job")).toBe(true);
    expect(rows[0]).toMatchObject({
      organization_id: "org-1",
      job_id: "job-1",
      title: "🚨 EMERGENCY intake: John Smith",
      body: "Water damage · 123 Main St",
      href: "/jobs/job-1",
    });
  });

  it("excludes inactive / deactivated members", async () => {
    seedJob(fake);
    fake.seed("user_organizations", [
      member("submitter", "admin", true),
      member("active-teammate", "crew_member", true),
      member("deactivated", "crew_member", false),
    ]);

    await dispatchNewIntakeNotifications({ jobId: "job-1", submitterUserId: "submitter" });

    expect(notifs(fake).map((r) => r.user_id)).toEqual(["active-teammate"]);
  });

  it("stays within the Job's Organization (never notifies another org's members)", async () => {
    seedJob(fake);
    fake.seed("user_organizations", [
      member("submitter", "admin", true),
      member("same-org", "crew_member", true, "org-1"),
      member("other-org", "admin", true, "org-2"),
    ]);

    await dispatchNewIntakeNotifications({ jobId: "job-1", submitterUserId: "submitter" });

    expect(notifs(fake).map((r) => r.user_id)).toEqual(["same-org"]);
  });

  it("reflects the Job's Urgency tier in the bell wording", async () => {
    seedJob(fake, { urgency: "urgent", damage_type: "Mold", property_address: "5 Elm Rd" });
    fake.seed("user_organizations", [
      member("submitter", "admin", true),
      member("teammate", "crew_member", true),
    ]);

    await dispatchNewIntakeNotifications({ jobId: "job-1", submitterUserId: "submitter" });

    expect(notifs(fake)[0]).toMatchObject({
      title: "Urgent intake: John Smith",
      body: "Mold · 5 Elm Rd",
    });
  });

  it("writes nothing when the submitter is the only active member", async () => {
    seedJob(fake);
    fake.seed("user_organizations", [member("submitter", "admin", true)]);

    await dispatchNewIntakeNotifications({ jobId: "job-1", submitterUserId: "submitter" });

    expect(notifs(fake)).toHaveLength(0);
  });

  describe("is best-effort — never throws when a downstream call errors", () => {
    it("swallows a job-lookup error and writes nothing", async () => {
      seedJob(fake);
      fake.seed("user_organizations", [member("teammate", "crew_member", true)]);
      fake.setError("jobs.select", { message: "db down" });

      await expect(
        dispatchNewIntakeNotifications({ jobId: "job-1", submitterUserId: "submitter" }),
      ).resolves.toBeUndefined();
      expect(notifs(fake)).toHaveLength(0);
    });

    it("swallows a member-lookup error and writes nothing", async () => {
      seedJob(fake);
      fake.seed("user_organizations", [member("teammate", "crew_member", true)]);
      fake.setError("user_organizations.select", { message: "db down" });

      await expect(
        dispatchNewIntakeNotifications({ jobId: "job-1", submitterUserId: "submitter" }),
      ).resolves.toBeUndefined();
      expect(notifs(fake)).toHaveLength(0);
    });

    it("swallows a notifications-insert error", async () => {
      seedJob(fake);
      fake.seed("user_organizations", [member("teammate", "crew_member", true)]);
      fake.setError("notifications.insert", { message: "write failed" });

      await expect(
        dispatchNewIntakeNotifications({ jobId: "job-1", submitterUserId: "submitter" }),
      ).resolves.toBeUndefined();
    });

    it("does nothing (no throw) when the Job no longer exists", async () => {
      // No jobs seeded.
      fake.seed("user_organizations", [member("teammate", "crew_member", true)]);

      await expect(
        dispatchNewIntakeNotifications({ jobId: "missing", submitterUserId: "submitter" }),
      ).resolves.toBeUndefined();
      expect(notifs(fake)).toHaveLength(0);
    });
  });
});

// ===========================================================================
// #673 — wire push into the dispatcher: after the in-app bell write, buzz the
// targeted members' enrolled iOS devices. The bell write stays primary; the
// push is a best-effort enhancement layered on top.
// ===========================================================================
describe("dispatchNewIntakeNotifications — push fan-out (#673)", () => {
  it("buzzes exactly the targeted members' devices — not the submitter's, not another org's — with the per-tier payload", async () => {
    seedJob(fake); // emergency · John Smith · Water damage · 123 Main St
    fake.seed("user_organizations", [
      member("submitter", "admin", true),
      member("teammate-a", "crew_lead", true),
      member("teammate-b", "crew_member", true),
      member("other-org", "admin", true, "org-2"),
    ]);
    fake.seed("device_tokens", [
      { id: "d0", user_id: "submitter", organization_id: "org-1", token: "tok-submitter" },
      { id: "d1", user_id: "teammate-a", organization_id: "org-1", token: "tok-a" },
      { id: "d2", user_id: "teammate-b", organization_id: "org-1", token: "tok-b" },
      { id: "d3", user_id: "other-org", organization_id: "org-2", token: "tok-other" },
    ]);
    const push = recordingPush();

    await dispatchNewIntakeNotifications(
      { jobId: "job-1", submitterUserId: "submitter" },
      push.deps,
    );

    // The in-app bell still fans out to the two active teammates.
    expect(notifs(fake).map((r) => r.user_id).sort()).toEqual(["teammate-a", "teammate-b"]);
    // The push reaches exactly their devices — never the submitter's own
    // device, never a member of another Organization.
    expect(push.tokens().sort()).toEqual(["tok-a", "tok-b"]);
    // The payload carries the emergency-tier wording, sound, and deep link.
    const body = JSON.parse(push.requests[0].body);
    expect(body.aps.alert).toEqual({
      title: "🚨 EMERGENCY intake: John Smith",
      body: "Water damage · 123 Main St",
    });
    expect(body.aps.sound).toBe("emergency.caf");
    expect(body.href).toBe("/jobs/job-1");
  });

  it("a targeted member with no enrolled device still gets the bell — push only reaches enrolled devices", async () => {
    seedJob(fake);
    fake.seed("user_organizations", [
      member("submitter", "admin", true),
      member("has-device", "crew_member", true),
      member("web-only", "crew_member", true),
    ]);
    fake.seed("device_tokens", [
      { id: "d1", user_id: "has-device", organization_id: "org-1", token: "tok-has" },
    ]);
    const push = recordingPush();

    await dispatchNewIntakeNotifications(
      { jobId: "job-1", submitterUserId: "submitter" },
      push.deps,
    );

    // The bell reaches both active teammates regardless of enrollment.
    expect(notifs(fake).map((r) => r.user_id).sort()).toEqual(["has-device", "web-only"]);
    // Only the enrolled device is buzzed; the web-only member gets the bell only.
    expect(push.tokens()).toEqual(["tok-has"]);
  });

  it("when no targeted member is enrolled, writes the bell and never calls the transport", async () => {
    seedJob(fake);
    fake.seed("user_organizations", [
      member("submitter", "admin", true),
      member("web-only", "crew_member", true),
    ]);
    // No device_tokens seeded at all.
    const push = recordingPush();

    await dispatchNewIntakeNotifications(
      { jobId: "job-1", submitterUserId: "submitter" },
      push.deps,
    );

    expect(notifs(fake).map((r) => r.user_id)).toEqual(["web-only"]);
    expect(push.requests).toHaveLength(0);
  });

  it("prunes the addresses the Apple sender reports dead, leaving the live ones", async () => {
    seedJob(fake);
    fake.seed("user_organizations", [
      member("submitter", "admin", true),
      member("live", "crew_member", true),
      member("dead", "crew_member", true),
    ]);
    fake.seed("device_tokens", [
      { id: "d1", user_id: "live", organization_id: "org-1", token: "tok-live" },
      { id: "d2", user_id: "dead", organization_id: "org-1", token: "tok-dead" },
    ]);
    const push = recordingPush((token) =>
      token === "tok-dead"
        ? { status: 410, reason: "Unregistered" }
        : { status: 200, apnsId: "ok" },
    );

    await dispatchNewIntakeNotifications(
      { jobId: "job-1", submitterUserId: "submitter" },
      push.deps,
    );

    // The dead address is dropped from the registry; the live one survives.
    expect(fake.tableRows("device_tokens").map((r) => r.token)).toEqual(["tok-live"]);
  });

  describe("push is best-effort — a buzz failure never undoes the bell", () => {
    it("never throws when the Apple sender errors; the bell is still written and nothing is pruned", async () => {
      seedJob(fake);
      fake.seed("user_organizations", [
        member("submitter", "admin", true),
        member("teammate", "crew_member", true),
      ]);
      fake.seed("device_tokens", [
        { id: "d1", user_id: "teammate", organization_id: "org-1", token: "tok-1" },
      ]);
      const push = recordingPush(() => {
        throw new Error("ECONNRESET: connection to Apple dropped");
      });

      await expect(
        dispatchNewIntakeNotifications(
          { jobId: "job-1", submitterUserId: "submitter" },
          push.deps,
        ),
      ).resolves.toBeUndefined();

      // The in-app bell — the durable record — is written regardless.
      expect(notifs(fake).map((r) => r.user_id)).toEqual(["teammate"]);
      // A transport error is not a dead address, so nothing is pruned.
      expect(fake.tableRows("device_tokens").map((r) => r.token)).toEqual(["tok-1"]);
    });

    it("contains a push-path failure (registry/token-lookup error) without blocking the bell write", async () => {
      seedJob(fake);
      fake.seed("user_organizations", [
        member("submitter", "admin", true),
        member("teammate", "crew_member", true),
      ]);
      fake.seed("device_tokens", [
        { id: "d1", user_id: "teammate", organization_id: "org-1", token: "tok-1" },
      ]);
      // The device-address lookup itself fails — a push-infra error that throws.
      fake.setError("device_tokens.select", { message: "registry unavailable" });
      const push = recordingPush();

      await expect(
        dispatchNewIntakeNotifications(
          { jobId: "job-1", submitterUserId: "submitter" },
          push.deps,
        ),
      ).resolves.toBeUndefined();

      // The bell write precedes the push attempt, so it survives the failure.
      expect(notifs(fake).map((r) => r.user_id)).toEqual(["teammate"]);
    });
  });
});
