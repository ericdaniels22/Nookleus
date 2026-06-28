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

const noParams = { params: Promise.resolve({}) };
function req(jobId?: string): Request {
  const url = jobId
    ? `http://test/api/time/sessions?jobId=${jobId}`
    : "http://test/api/time/sessions";
  return new Request(url, { method: "GET" });
}

function useUser(opts: Parameters<typeof fakeClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(fakeClient(opts) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// issue #701 — reading recorded hours is gated on `track_time`.
describe("GET /api/time/sessions — permission gate (#701)", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await GET(req("job-1"), noParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks track_time", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "crew_member", grants: [] }),
    });
    const res = await GET(req("job-1"), noParams);
    expect(res.status).toBe(403);
  });

  it("returns 400 when a track_time holder omits jobId", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "crew_member", grants: ["track_time"] }),
    });
    const res = await GET(req(), noParams);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/time/sessions — own hours only (#701)", () => {
  it("returns only the caller's own sessions for the Job — never a coworker's", async () => {
    const client = fakeClient({
      user: { id: "u-1" },
      tables: {
        ...memberTables({ userId: "u-1", role: "crew_member", grants: ["track_time"] }),
        time_sessions: [
          // The caller's two sessions on job-1.
          { id: "s-mine-1", job_id: "job-1", user_id: "u-1", organization_id: "org-1", started_at: "2026-06-18T09:00:00Z", ended_at: "2026-06-18T12:00:00Z" },
          { id: "s-mine-2", job_id: "job-1", user_id: "u-1", organization_id: "org-1", started_at: "2026-06-19T12:00:00Z", ended_at: null },
          // A coworker's session on the same Job — MUST NOT be returned.
          { id: "s-coworker", job_id: "job-1", user_id: "u-2", organization_id: "org-1", started_at: "2026-06-18T08:00:00Z", ended_at: "2026-06-18T17:00:00Z" },
          // The caller's own session on a DIFFERENT Job — MUST NOT be returned.
          { id: "s-other-job", job_id: "job-2", user_id: "u-1", organization_id: "org-1", started_at: "2026-06-17T09:00:00Z", ended_at: "2026-06-17T10:00:00Z" },
        ],
      },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(req("job-1"), noParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    const ids = body.sessions.map((s: { sessionId: string }) => s.sessionId).sort();
    expect(ids).toEqual(["s-mine-1", "s-mine-2"]);
  });

  // AC4 (#706) — a hand-entered/corrected session must be distinguishable
  // wherever sessions are listed, so the row carries its capture marker through
  // to the client (the UI renders "Hand-entered" for 'hand', nothing for 'live').
  it("carries each session's capture marker (live vs hand)", async () => {
    const client = fakeClient({
      user: { id: "u-1" },
      tables: {
        ...memberTables({ userId: "u-1", role: "crew_member", grants: ["track_time"] }),
        time_sessions: [
          { id: "s-live", job_id: "job-1", user_id: "u-1", organization_id: "org-1", started_at: "2026-06-18T09:00:00Z", ended_at: "2026-06-18T12:00:00Z", capture_method: "live" },
          { id: "s-hand", job_id: "job-1", user_id: "u-1", organization_id: "org-1", started_at: "2026-06-19T09:00:00Z", ended_at: "2026-06-19T17:00:00Z", capture_method: "hand" },
        ],
      },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(req("job-1"), noParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = Object.fromEntries(
      (body.sessions as { sessionId: string; capture: string }[]).map((s) => [s.sessionId, s.capture]),
    );
    expect(byId["s-live"]).toBe("live");
    expect(byId["s-hand"]).toBe("hand");
  });

  it("returns an empty list when the caller has no sessions on the Job", async () => {
    const client = fakeClient({
      user: { id: "u-1" },
      tables: {
        ...memberTables({ userId: "u-1", role: "crew_member", grants: ["track_time"] }),
        time_sessions: [],
      },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(req("job-1"), noParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });
});
