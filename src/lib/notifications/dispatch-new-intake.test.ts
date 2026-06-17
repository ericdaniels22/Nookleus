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
    const builder = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return builder;
      },
      async maybeSingle() {
        const err = errors[`${table}.select`];
        if (err) return { data: null, error: err };
        return {
          data: (tables[table] ?? []).find((r) => match(r, filters)) ?? null,
          error: null,
        };
      },
      then(resolve: (v: { data: unknown; error: FakeError | null }) => unknown) {
        const err = errors[`${table}.select`];
        if (err) return resolve({ data: null, error: err });
        return resolve({
          data: (tables[table] ?? []).filter((r) => match(r, filters)),
          error: null,
        });
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
