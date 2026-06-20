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

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeClient,
  memberTables,
} from "@/lib/request-context/__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };
function req(body?: unknown): Request {
  return new Request("http://test/api/time/clock-out", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function useUser(opts: Parameters<typeof fakeClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(fakeClient(opts) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// issue #701 — clocking out is a Time mutation gated on `track_time`.
describe("POST /api/time/clock-out — permission gate (#701)", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await POST(req(), noParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks track_time", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "crew_member", grants: [] }),
    });
    const res = await POST(req(), noParams);
    expect(res.status).toBe(403);
  });
});

// The mutation. The pure decision (close / nothing-open) is owned by
// session-lifecycle.ts; these tests assert the route loads the worker's Open
// session, hands it to that decision, and performs the decided close via the
// atomic clock_out_session RPC.
function trackTimeClient(opts: {
  userId?: string;
  openSession?: { id: string; job_id: string; started_at: string } | null;
}) {
  const userId = opts.userId ?? "u-1";
  const openSession = opts.openSession;
  return fakeClient({
    user: { id: userId },
    tables: {
      ...memberTables({ userId, role: "crew_member", grants: ["track_time"] }),
      time_sessions: openSession
        ? [{ ...openSession, user_id: userId, organization_id: "org-1" }]
        : [],
    },
  });
}

describe("POST /api/time/clock-out — clocking out (#701)", () => {
  it("with an Open session: closes it via clock_out_session, returns the closed session", async () => {
    const client = trackTimeClient({
      openSession: { id: "open-1", job_id: "job-1", started_at: "2026-06-19T12:00:00Z" },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(req(), noParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.closed).toBe(true);
    expect(body.sessionId).toBe("open-1");
    expect(body.jobId).toBe("job-1");
    expect(typeof body.endedAt).toBe("string");

    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0].name).toBe("clock_out_session");
    const args = client.rpcCalls[0].args;
    expect(args.p_session_id).toBe("open-1");
    expect(args.p_organization_id).toBe("org-1");
    expect(args.p_actor).toBe("u-1");
    expect(args.p_ended_at).toBe(body.endedAt);
  });

  it("with no Open session: idempotent no-op — closed:false, writes nothing", async () => {
    const client = trackTimeClient({ openSession: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(req(), noParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.closed).toBe(false);

    expect(client.rpcCalls).toHaveLength(0);
  });

  it("when the atomic close fails, surfaces an error — never a false success", async () => {
    const client = fakeClient({
      user: { id: "u-1" },
      tables: {
        ...memberTables({ userId: "u-1", role: "crew_member", grants: ["track_time"] }),
        time_sessions: [
          { id: "open-1", job_id: "job-1", started_at: "2026-06-19T12:00:00Z", user_id: "u-1", organization_id: "org-1" },
        ],
      },
      rpcError: { message: "session not found or already closed" },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(req(), noParams);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

// issue #702 — the offline path. A queued clock-out is device-stamped (takenAt)
// and names the ORIGINAL session it was tapped for (sessionId), because by the
// time it drains the worker may have clocked into a different Job. It carries a
// clientCaptureId so a replay — or a late tap against a session already resolved
// by a lead — is an idempotent no-op server-side, never a back-date.
describe("POST /api/time/clock-out — offline-resilient tap (#702)", () => {
  it("closes the named original session at the device takenAt, forwarding the capture id", async () => {
    const client = trackTimeClient({ openSession: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const takenAt = "2026-06-19T17:45:00.000Z";
    const res = await POST(
      req({ sessionId: "orig-1", takenAt, clientCaptureId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }),
      noParams,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.closed).toBe(true);
    expect(body.sessionId).toBe("orig-1");
    expect(body.endedAt).toBe(takenAt);

    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0].name).toBe("clock_out_session");
    const args = client.rpcCalls[0].args;
    expect(args.p_session_id).toBe("orig-1");
    expect(args.p_ended_at).toBe(takenAt);
    expect(args.p_organization_id).toBe("org-1");
    expect(args.p_actor).toBe("u-1");
    expect(args.p_client_capture_id).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  });

  it("targets the named session even when the worker has since clocked into a different Job", async () => {
    // The worker is currently Open on a DIFFERENT session (they switched Jobs
    // after the offline clock-out was tapped). The queued tap must still close
    // the original session it named — not the current Open one.
    const client = trackTimeClient({
      openSession: { id: "current-2", job_id: "job-2", started_at: "2026-06-19T18:00:00Z" },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(
      req({ sessionId: "orig-1", takenAt: "2026-06-19T17:45:00.000Z" }),
      noParams,
    );
    expect(res.status).toBe(200);

    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0].args.p_session_id).toBe("orig-1");
  });
});
