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
function req(): Request {
  return new Request("http://test/api/time/active", { method: "GET" });
}

function useUser(opts: Parameters<typeof fakeClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(fakeClient(opts) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// issue #701 — the app-wide status bar reads the caller's current Open session.
describe("GET /api/time/active — permission gate (#701)", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await GET(req(), noParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks track_time", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "crew_member", grants: [] }),
    });
    const res = await GET(req(), noParams);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/time/active — current Open session (#701)", () => {
  it("returns the caller's Open session, labeled with its Job, when one exists", async () => {
    const client = fakeClient({
      user: { id: "u-1" },
      tables: {
        ...memberTables({ userId: "u-1", role: "crew_member", grants: ["track_time"] }),
        time_sessions: [
          // An open session (no ended_at) and a closed one — only the open one is active.
          { id: "open-1", job_id: "job-9", user_id: "u-1", organization_id: "org-1", started_at: "2026-06-19T12:00:00Z", ended_at: null },
          { id: "closed-1", job_id: "job-8", user_id: "u-1", organization_id: "org-1", started_at: "2026-06-18T09:00:00Z", ended_at: "2026-06-18T12:00:00Z" },
        ],
        jobs: [
          { id: "job-9", job_number: "J-1009", property_address: "12 Maple St" },
        ],
      },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(req(), noParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.active).toEqual({
      sessionId: "open-1",
      jobId: "job-9",
      startedAt: "2026-06-19T12:00:00Z",
      job: { job_number: "J-1009", property_address: "12 Maple St" },
    });
  });

  it("returns null when the caller has no Open session", async () => {
    const client = fakeClient({
      user: { id: "u-1" },
      tables: {
        ...memberTables({ userId: "u-1", role: "crew_member", grants: ["track_time"] }),
        time_sessions: [
          { id: "closed-1", job_id: "job-8", user_id: "u-1", organization_id: "org-1", started_at: "2026-06-18T09:00:00Z", ended_at: "2026-06-18T12:00:00Z" },
        ],
      },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(req(), noParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBeNull();
  });
});
