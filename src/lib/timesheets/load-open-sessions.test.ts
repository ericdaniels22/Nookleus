// load-open-sessions — the read-side of Presence (#705, epic #699). Resolves an
// Organization (optionally one Job) to the list of app Users currently On the
// clock: their open `time_sessions`, each shaped with the worker's display name
// and the Job they are on. It feeds both presence surfaces — the per-Job "On
// site now" indicator and the owner-dashboard org-wide "On the clock now".
//
// The contract this loader guarantees, tested through its return value:
//   - only OPEN sessions (ended_at IS NULL), never clocked-out or soft-deleted
//   - only APP Users — Off-app workers (a typed `off_app_worker_name`, no
//     user_id) must NEVER appear on a presence surface (issue #705 AC)
//   - scoped to ONE organization id (cross-org isolation), optionally one Job
//
// ADR 0019: presence carries identity + Job + time only — no GPS/location.

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadOpenSessions } from "./load-open-sessions";

// A fake `time_sessions` query builder. It records every filter the loader
// applied (so cross-org / per-Job scoping is observable the way
// load-org-timezone.test.ts asserts isolation) and resolves to the given rows
// verbatim — it does NOT itself apply the filters, so any exclusion the loader
// promises in its RESULT must be enforced by the loader, not the fake.
function fakeSupabase(
  rows: Array<Record<string, unknown>>,
  capture?: (filters: Record<string, string>) => void,
) {
  const filters: Record<string, string> = {};
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = (col: string, val: string) => {
    filters[`eq:${col}`] = val;
    return builder;
  };
  builder.is = (col: string, val: unknown) => {
    filters[`is:${col}`] = String(val);
    return builder;
  };
  builder.not = (col: string, op: string, val: unknown) => {
    filters[`not:${col}`] = `${op}.${String(val)}`;
    return builder;
  };
  builder.order = () => builder;
  builder.then = (resolve: (r: unknown) => void) => {
    capture?.(filters);
    resolve({ data: rows, error: null });
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

// A typical open app-User session row as PostgREST returns it for this loader's
// select: scalar columns plus the embedded one-to-one joins.
function openRow(over: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    user_id: "user-1",
    job_id: "job-1",
    started_at: "2026-06-27T14:00:00.000Z",
    ended_at: null,
    deleted_at: null,
    user_profiles: { full_name: "Jordan Rivera" },
    jobs: { job_number: "J-100", property_address: "12 Oak St" },
    ...over,
  };
}

describe("loadOpenSessions", () => {
  it("returns each open app-User session shaped with worker name and Job", async () => {
    const supabase = fakeSupabase([openRow()]);

    const sessions = await loadOpenSessions(supabase, {
      organizationId: "org-1",
    });

    expect(sessions).toEqual([
      {
        sessionId: "sess-1",
        userId: "user-1",
        jobId: "job-1",
        startedAt: "2026-06-27T14:00:00.000Z",
        workerName: "Jordan Rivera",
        job: { jobNumber: "J-100", propertyAddress: "12 Oak St" },
      },
    ]);
  });

  it("scopes the read to the requested Organization (cross-org isolation)", async () => {
    let filters: Record<string, string> = {};
    const supabase = fakeSupabase([openRow()], (f) => (filters = f));

    await loadOpenSessions(supabase, { organizationId: "org-42" });

    // Only org-42's sessions are ever requested; the open-and-not-deleted,
    // app-User-only constraints are part of the same scoped query.
    expect(filters["eq:organization_id"]).toBe("org-42");
    expect(filters["is:ended_at"]).toBe("null");
    expect(filters["is:deleted_at"]).toBe("null");
    expect(filters["not:user_id"]).toBe("is.null");
    // No Job filter unless asked for.
    expect(filters["eq:job_id"]).toBeUndefined();
  });

  it("narrows to a single Job when a jobId is given (per-Job 'On site now')", async () => {
    let filters: Record<string, string> = {};
    const supabase = fakeSupabase([openRow()], (f) => (filters = f));

    await loadOpenSessions(supabase, {
      organizationId: "org-1",
      jobId: "job-7",
    });

    expect(filters["eq:organization_id"]).toBe("org-1");
    expect(filters["eq:job_id"]).toBe("job-7");
  });

  it("excludes Off-app workers, clocked-out, and soft-deleted sessions from the result", async () => {
    const supabase = fakeSupabase([
      openRow({ id: "keep", user_id: "user-1" }),
      // Off-app worker: a typed name, no app User — must never surface.
      openRow({
        id: "offapp",
        user_id: null,
        user_profiles: null,
      }),
      // Already clocked out.
      openRow({ id: "ended", user_id: "user-2", ended_at: "2026-06-27T15:00:00.000Z" }),
      // Soft-deleted.
      openRow({ id: "deleted", user_id: "user-3", deleted_at: "2026-06-27T15:00:00.000Z" }),
    ]);

    const sessions = await loadOpenSessions(supabase, {
      organizationId: "org-1",
    });

    expect(sessions.map((s) => s.sessionId)).toEqual(["keep"]);
  });

  it("keeps a session whose worker has no profile name (workerName is null, not dropped)", async () => {
    const supabase = fakeSupabase([
      openRow({ user_id: "user-9", user_profiles: null }),
    ]);

    const [session] = await loadOpenSessions(supabase, {
      organizationId: "org-1",
    });

    expect(session.userId).toBe("user-9");
    expect(session.workerName).toBeNull();
  });

  it("throws on a query error rather than silently returning an empty roster", async () => {
    const supabase = {
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.is = () => b;
        b.not = () => b;
        b.order = () => b;
        b.then = (resolve: (r: unknown) => void) =>
          resolve({ data: null, error: { message: "boom" } });
        return b;
      },
    } as unknown as SupabaseClient;

    await expect(
      loadOpenSessions(supabase, { organizationId: "org-1" }),
    ).rejects.toThrow("boom");
  });
});
