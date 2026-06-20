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
  return new Request("http://test/api/time/clock-in", {
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

// issue #701 — clocking in is a Time mutation gated on `track_time`. The
// wrapper denies an unauthenticated request before the handler runs.
describe("POST /api/time/clock-in — permission gate (#701)", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await POST(req({ jobId: "job-1" }), noParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks track_time", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "crew_member", grants: [] }),
    });
    const res = await POST(req({ jobId: "job-1" }), noParams);
    expect(res.status).toBe(403);
  });

  it("returns 400 when a track_time holder sends no jobId", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "crew_member", grants: ["track_time"] }),
    });
    const res = await POST(req({}), noParams);
    expect(res.status).toBe(400);
  });
});

// The mutation itself. The pure decision (open / already-open / switch) is
// owned and tested by session-lifecycle.ts; these tests assert the route
// loads the worker's Open session, hands it to that decision, and performs
// the decided writes through the atomic clock_in_to_job RPC.
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
      // A real open row carries the owner and Org; the route loads it filtered
      // on both. ended_at/deleted_at left unset so `is(…, null)` matches.
      time_sessions: openSession
        ? [{ ...openSession, user_id: userId, organization_id: "org-1" }]
        : [],
    },
  });
}

describe("POST /api/time/clock-in — clocking in (#701)", () => {
  it("with no Open session: clocks in via clock_in_to_job, returns the new session", async () => {
    const client = trackTimeClient({ openSession: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(req({ jobId: "job-1" }), noParams);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.jobId).toBe("job-1");
    expect(body.switched).toBe(false);
    expect(typeof body.sessionId).toBe("string");

    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0].name).toBe("clock_in_to_job");
    const args = client.rpcCalls[0].args;
    expect(args.p_job_id).toBe("job-1");
    expect(args.p_user_id).toBe("u-1");
    expect(args.p_organization_id).toBe("org-1");
    expect(args.p_actor).toBe("u-1");
    expect(args.p_session_id).toBe(body.sessionId);
    expect(args.p_close_session_id).toBeNull();
    expect(args.p_close_ended_at).toBeNull();
  });

  it("already Open on the same Job: returns the existing session, writes nothing", async () => {
    const client = trackTimeClient({
      openSession: { id: "open-1", job_id: "job-1", started_at: "2026-06-19T12:00:00Z" },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(req({ jobId: "job-1" }), noParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sessionId).toBe("open-1");
    expect(body.alreadyOpen).toBe(true);

    expect(client.rpcCalls).toHaveLength(0);
  });

  it("Open on a different Job: switches — closes the prior session and opens the new one atomically", async () => {
    const client = trackTimeClient({
      openSession: { id: "open-1", job_id: "job-1", started_at: "2026-06-19T12:00:00Z" },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(req({ jobId: "job-2" }), noParams);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.jobId).toBe("job-2");
    expect(body.switched).toBe(true);
    expect(body.closedJobId).toBe("job-1");
    expect(typeof body.sessionId).toBe("string");
    expect(body.sessionId).not.toBe("open-1");

    // One atomic call closes open-1 and opens the new session in the same RPC.
    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0].name).toBe("clock_in_to_job");
    const args = client.rpcCalls[0].args;
    expect(args.p_job_id).toBe("job-2");
    expect(args.p_user_id).toBe("u-1");
    expect(args.p_organization_id).toBe("org-1");
    expect(args.p_session_id).toBe(body.sessionId);
    expect(args.p_close_session_id).toBe("open-1");
    // The prior session ends at the same instant the new one starts.
    expect(args.p_close_ended_at).toBe(body.startedAt);
  });

  it("when the atomic write fails (e.g. an open-session race), surfaces an error — never a false 201", async () => {
    const client = fakeClient({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "crew_member", grants: ["track_time"] }),
      rpcError: { message: "duplicate key value violates unique constraint" },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(req({ jobId: "job-1" }), noParams);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

// issue #702 — the offline path. A tap is device-stamped (takenAt) and carries
// a client-generated idempotency key (clientCaptureId). The route honors the
// device tap instant as the recorded session start (device time is authoritative
// for the tap instant) and forwards the key so a replay is idempotent server-side.
describe("POST /api/time/clock-in — offline-resilient tap (#702)", () => {
  it("records the device takenAt as the session start, not a server clock", async () => {
    const client = trackTimeClient({ openSession: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const takenAt = "2026-06-19T07:30:00.000Z";
    const res = await POST(req({ jobId: "job-1", takenAt }), noParams);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.startedAt).toBe(takenAt);
    expect(client.rpcCalls[0].args.p_started_at).toBe(takenAt);
  });

  it("forwards the clientCaptureId so a replayed tap is idempotent server-side", async () => {
    const client = trackTimeClient({ openSession: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const clientCaptureId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const res = await POST(req({ jobId: "job-1", clientCaptureId }), noParams);
    expect(res.status).toBe(201);

    expect(client.rpcCalls[0].args.p_client_capture_id).toBe(clientCaptureId);
  });

  it("a direct (online) tap with no capture id sends a null p_client_capture_id", async () => {
    const client = trackTimeClient({ openSession: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(req({ jobId: "job-1" }), noParams);
    expect(res.status).toBe(201);

    expect(client.rpcCalls[0].args.p_client_capture_id).toBeNull();
  });

  it("uses a device-provided sessionId as the new session's id, so a fully-offline clock-out can reference it before the clock-in ever syncs", async () => {
    // Design A: the device commits to the session id at tap time (the migration
    // inserts the row with id = p_session_id). A queued clock-out names that same
    // id; strict-FIFO drain guarantees the clock-in row exists first.
    const client = trackTimeClient({ openSession: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const sessionId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const res = await POST(
      req({ jobId: "job-1", sessionId, clientCaptureId: "cap-x" }),
      noParams,
    );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.sessionId).toBe(sessionId);
    expect(client.rpcCalls[0].args.p_session_id).toBe(sessionId);
  });

  it("reports the session id the RPC resolved, so a replayed tap returns the original session — not the freshly proposed id", async () => {
    // On a replay the idempotent clock_in_to_job returns the ORIGINAL session id,
    // which differs from the new id the route proposed. The route must surface
    // the RPC's id so the device records the real session (and its later
    // clock-out can find it).
    const client = fakeClient({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "crew_member", grants: ["track_time"] }),
      rpcData: "original-session-9",
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(
      req({ jobId: "job-1", clientCaptureId: "cccccccc-cccc-cccc-cccc-cccccccccccc" }),
      noParams,
    );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.sessionId).toBe("original-session-9");
    // The proposed id was a fresh UUID the route generated; it is not what the
    // RPC resolved, so it must not be what the route reports.
    expect(client.rpcCalls[0].args.p_session_id).not.toBe("original-session-9");
  });
});
