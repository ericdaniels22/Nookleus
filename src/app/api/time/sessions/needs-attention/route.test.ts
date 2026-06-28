import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeClient,
  memberTables,
} from "@/lib/request-context/__test-utils__/request-context-fakes";

const HOUR = 60 * 60 * 1000;
// Offsets from real now — the route reads the real clock, so the test anchors
// started_at relative to it (margins of hours dwarf the ms of test/route skew).
function agoHours(h: number): string {
  return new Date(Date.now() - h * HOUR).toISOString();
}

function req(jobId?: string): Request {
  const url = new URL("http://test/api/time/sessions/needs-attention");
  if (jobId !== undefined) url.searchParams.set("jobId", jobId);
  return new Request(url, { method: "GET" });
}
const noParams = { params: Promise.resolve({}) };

// A crew_lead who holds manage_timesheets, plus the seeded time_sessions rows
// and any extra tables (e.g. company_settings for the Org timezone).
function leadClient(
  sessions: Record<string, unknown>[],
  extraTables: Record<string, Record<string, unknown>[]> = {},
) {
  return fakeClient({
    user: { id: "lead-1" },
    tables: {
      ...memberTables({ userId: "lead-1", role: "crew_lead", grants: ["track_time", "manage_timesheets"] }),
      time_sessions: sessions,
      ...extraTables,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// AC6 — the needs-attention surface is gated by manage_timesheets, like the
// Correction it leads into. A track_time-only worker cannot see it.
describe("GET /api/time/sessions/needs-attention — manage_timesheets gate (#706)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(fakeClient({ user: null }) as never);
    const res = await GET(req("job-1"), noParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a track_time-only worker", async () => {
    const client = fakeClient({
      user: { id: "w-1" },
      tables: memberTables({ userId: "w-1", role: "crew_member", grants: ["track_time"] }),
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
    const res = await GET(req("job-1"), noParams);
    expect(res.status).toBe(403);
  });
});

// AC5 — the list is the Open sessions for the Job whose elapsed time exceeds
// ~12h, across ALL workers (the lead supervises everyone, unlike the own-hours
// list). Under-threshold Open sessions and closed sessions never appear, and
// listing mutates nothing.
describe("GET /api/time/sessions/needs-attention — the list (#706)", () => {
  it("returns only Open sessions past ~12h for the Job, never closed or under-threshold ones", async () => {
    const client = leadClient([
      // Open 13h — needs attention.
      { id: "old-open", job_id: "job-1", user_id: "worker-a", organization_id: "org-1", started_at: agoHours(13), ended_at: null },
      // Open 1h — under threshold, excluded.
      { id: "fresh-open", job_id: "job-1", user_id: "worker-b", organization_id: "org-1", started_at: agoHours(1), ended_at: null },
      // Closed, ran 20h — closed sessions never appear, however long.
      { id: "closed-long", job_id: "job-1", user_id: "worker-c", organization_id: "org-1", started_at: agoHours(30), ended_at: agoHours(10) },
      // Open 14h but a DIFFERENT Job — out of this Job's context.
      { id: "other-job", job_id: "job-2", user_id: "worker-d", organization_id: "org-1", started_at: agoHours(14), ended_at: null },
    ]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(req("job-1"), noParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    const ids = (body.sessions as { sessionId: string }[]).map((s) => s.sessionId);
    expect(ids).toEqual(["old-open"]);

    // Listing mutates nothing — no RPC, no write.
    expect(client.rpcCalls).toHaveLength(0);
  });

  it("returns 400 when jobId is missing", async () => {
    const client = leadClient([]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
    const res = await GET(req(), noParams);
    expect(res.status).toBe(400);
  });

  // AC4 — a hand-entered/edited session is marked WHEREVER it is shown. An Open
  // session can already be hand-entered (a lead corrected only its clock-in, so
  // it stays Open) — so the needs-attention list must carry each session's
  // capture marker, not assume Open ⇒ live.
  it("carries each session's capture marker so the list can flag hand-entered ones", async () => {
    const client = leadClient([
      // Open 13h, clock-in was hand-corrected → still Open, but hand-entered.
      { id: "hand-open", job_id: "job-1", user_id: "worker-a", organization_id: "org-1", started_at: agoHours(13), ended_at: null, capture_method: "hand" },
      // Open 14h, never touched → live.
      { id: "live-open", job_id: "job-1", user_id: "worker-b", organization_id: "org-1", started_at: agoHours(14), ended_at: null, capture_method: "live" },
    ]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(req("job-1"), noParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    const byId = Object.fromEntries(
      (body.sessions as { sessionId: string; capture: string }[]).map((s) => [s.sessionId, s.capture]),
    );
    expect(byId).toEqual({ "hand-open": "hand", "live-open": "live" });
  });
});

// ADR 0020 — every clock-in/out is anchored in the ONE Organization timezone,
// never the lead's device clock. The list surface displays times and the
// Correction form converts a typed wall-clock back to an instant, so BOTH need
// the same zone; the server is its authority and hands it to the client.
describe("GET /api/time/sessions/needs-attention — Org timezone (#706, ADR 0020)", () => {
  it("returns the Organization's resolved IANA timezone alongside the sessions", async () => {
    const client = leadClient([], {
      company_settings: [
        { organization_id: "org-1", key: "timezone", value: "America/Chicago" },
      ],
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(req("job-1"), noParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.timeZone).toBe("America/Chicago");
  });

  it("falls back to UTC when the Org has no timezone setting, never the host clock", async () => {
    const client = leadClient([]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(req("job-1"), noParams);
    const body = await res.json();
    expect(body.timeZone).toBe("UTC");
  });
});

// AC5 — the list is the lead's ENTRY POINT to a Correction across ALL workers,
// so each entry must name WHO it belongs to (a bare user id is unusable). The
// name is a separate user_profiles lookup; a missing profile degrades to null
// rather than failing the whole list.
describe("GET /api/time/sessions/needs-attention — worker name (#706)", () => {
  it("attaches each session's worker full_name from user_profiles", async () => {
    const client = leadClient(
      [
        { id: "open-a", job_id: "job-1", user_id: "worker-a", organization_id: "org-1", started_at: agoHours(13), ended_at: null, capture_method: "live" },
        { id: "open-x", job_id: "job-1", user_id: "worker-x", organization_id: "org-1", started_at: agoHours(15), ended_at: null, capture_method: "live" },
      ],
      {
        user_profiles: [
          { id: "worker-a", full_name: "Ada Crew" },
          // worker-x has no profile row → name degrades to null.
        ],
      },
    );
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(req("job-1"), noParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    const byId = Object.fromEntries(
      (body.sessions as { sessionId: string; workerName: string | null }[]).map((s) => [
        s.sessionId,
        s.workerName,
      ]),
    );
    expect(byId).toEqual({ "open-a": "Ada Crew", "open-x": null });
  });
});
