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

import { PATCH } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeClient,
  memberTables,
} from "@/lib/request-context/__test-utils__/request-context-fakes";

const SESSION_ID = "sess-1";
function paramsFor(id = SESSION_ID) {
  return { params: Promise.resolve({ id }) };
}
function req(body?: unknown): Request {
  return new Request(`http://test/api/time/sessions/${SESSION_ID}`, {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// A crew_lead who holds manage_timesheets, with one existing recorded session
// (id SESSION_ID) the Correction targets. `session` overrides its stored times.
function leadClient(opts?: {
  userId?: string;
  session?: { started_at?: string; ended_at?: string | null; user_id?: string } | null;
  rpcError?: { message: string } | null;
}) {
  const userId = opts?.userId ?? "lead-1";
  const session =
    opts?.session === null
      ? undefined
      : {
          id: SESSION_ID,
          organization_id: "org-1",
          job_id: "job-1",
          user_id: opts?.session?.user_id ?? "worker-9",
          started_at: opts?.session?.started_at ?? "2026-06-19T12:00:00.000Z",
          ended_at:
            opts?.session && "ended_at" in opts.session
              ? opts.session.ended_at
              : "2026-06-19T20:00:00.000Z",
        };
  return fakeClient({
    user: { id: userId },
    tables: {
      ...memberTables({ userId, role: "crew_lead", grants: ["track_time", "manage_timesheets"] }),
      time_sessions: session ? [session] : [],
    },
    rpcError: opts?.rpcError ?? null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// AC6 — Corrections are gated by the NEW manage_timesheets permission, NOT
// track_time. A worker who can only self-clock (crew_member, track_time only)
// gets the project's standard unauthorized response (403); an unauthenticated
// caller gets 401. crew_lead/admin (who hold manage_timesheets) succeed — the
// happy-path test below.
describe("PATCH /api/time/sessions/[id] — manage_timesheets gate (#706)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeClient({ user: null }) as never,
    );
    const res = await PATCH(req({ startedAt: "2026-06-19T13:00:00.000Z" }), paramsFor());
    expect(res.status).toBe(401);
  });

  it("returns 403 for a track_time-only worker (no manage_timesheets), writing nothing", async () => {
    const client = fakeClient({
      user: { id: "w-1" },
      tables: memberTables({ userId: "w-1", role: "crew_member", grants: ["track_time"] }),
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
    const res = await PATCH(req({ startedAt: "2026-06-19T13:00:00.000Z" }), paramsFor());
    expect(res.status).toBe(403);
    expect(client.rpcCalls).toHaveLength(0);
  });
});

// AC1/AC2 — a lead corrects an existing session's clock-in AND clock-out; the
// route performs the decided write through the atomic correct_time_session RPC,
// which (in SQL) flips capture_method to 'hand' and appends the one 'corrected'
// audit event. The route's contract: exactly one RPC call, carrying the session,
// the org, the acting user, and the two new times.
describe("PATCH /api/time/sessions/[id] — correcting a session (#706)", () => {
  it("corrects both clock-in and clock-out via correct_time_session", async () => {
    const client = leadClient();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const startedAt = "2026-06-19T13:00:00.000Z";
    const endedAt = "2026-06-19T19:30:00.000Z";
    const res = await PATCH(req({ startedAt, endedAt }), paramsFor());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.corrected).toBe(true);
    expect(body.sessionId).toBe(SESSION_ID);

    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0].name).toBe("correct_time_session");
    const args = client.rpcCalls[0].args;
    expect(args.p_session_id).toBe(SESSION_ID);
    expect(args.p_organization_id).toBe("org-1");
    expect(args.p_actor).toBe("lead-1");
    expect(args.p_started_at).toBe(startedAt);
    expect(args.p_ended_at).toBe(endedAt);
  });
});

// AC3 — a Correction that would produce an impossible span (clock-out at or
// before clock-in) is rejected by the session-lifecycle invariant (validateSpan)
// with a clear error, BEFORE any write: no RPC call, so no event and no
// capture_method change. The pure rule lives in session-lifecycle.ts; the route
// just refuses to ask the database to break it.
describe("PATCH /api/time/sessions/[id] — rejects impossible spans (#706)", () => {
  it("rejects clock-out before clock-in (both fields given), writing nothing", async () => {
    const client = leadClient();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await PATCH(
      req({ startedAt: "2026-06-19T19:00:00.000Z", endedAt: "2026-06-19T13:00:00.000Z" }),
      paramsFor(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(client.rpcCalls).toHaveLength(0);
  });

  it("rejects clock-out equal to clock-in (zero-length span), writing nothing", async () => {
    const client = leadClient();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const at = "2026-06-19T13:00:00.000Z";
    const res = await PATCH(req({ startedAt: at, endedAt: at }), paramsFor());
    expect(res.status).toBe(400);
    expect(client.rpcCalls).toHaveLength(0);
  });

  it("rejects a new clock-out before the EXISTING clock-in (single-field edit), writing nothing", async () => {
    // Existing session started 12:00; correct only the clock-out to 11:00 — the
    // resulting span (12:00 → 11:00) is impossible. The route must validate the
    // new end against the session's stored start, so it loads the session first.
    const client = leadClient({ session: { started_at: "2026-06-19T12:00:00.000Z" } });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await PATCH(req({ endedAt: "2026-06-19T11:00:00.000Z" }), paramsFor());
    expect(res.status).toBe(400);
    expect(client.rpcCalls).toHaveLength(0);
  });

  it("rejects a new clock-in at/after the EXISTING clock-out (single-field edit), writing nothing", async () => {
    // Existing session ended 20:00; correct only the clock-in to 21:00 — the
    // resulting span (21:00 → 20:00) is impossible.
    const client = leadClient({
      session: { started_at: "2026-06-19T12:00:00.000Z", ended_at: "2026-06-19T20:00:00.000Z" },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await PATCH(req({ startedAt: "2026-06-19T21:00:00.000Z" }), paramsFor());
    expect(res.status).toBe(400);
    expect(client.rpcCalls).toHaveLength(0);
  });

  it("returns 404 when the targeted session does not exist (or is in another org)", async () => {
    const client = leadClient({ session: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await PATCH(req({ endedAt: "2026-06-19T19:00:00.000Z" }), paramsFor());
    expect(res.status).toBe(404);
    expect(client.rpcCalls).toHaveLength(0);
  });
});

// AC3 — a worker is On the clock for at most one Job at a time, so their
// recorded spans must never overlap. A Correction that would push a session to
// collide with another of the SAME worker's closed sessions is rejected by the
// session-lifecycle invariant (validateCorrectedSpan) BEFORE any write — no RPC
// call, so no event and no capture_method change. A span that merely touches
// another at an endpoint is NOT an overlap and is allowed.
describe("PATCH /api/time/sessions/[id] — rejects overlapping spans (#706)", () => {
  // The targeted session (SESSION_ID) plus a second CLOSED session for the same
  // worker on another Job, 13:00–17:00. `target` overrides the targeted session's
  // stored times.
  function clientWithSibling(target: { started_at: string; ended_at: string | null }) {
    const userId = "lead-1";
    return fakeClient({
      user: { id: userId },
      tables: {
        ...memberTables({ userId, role: "crew_lead", grants: ["track_time", "manage_timesheets"] }),
        time_sessions: [
          {
            id: SESSION_ID,
            organization_id: "org-1",
            job_id: "job-1",
            user_id: "worker-9",
            started_at: target.started_at,
            ended_at: target.ended_at,
          },
          {
            id: "sess-2",
            organization_id: "org-1",
            job_id: "job-2",
            user_id: "worker-9",
            started_at: "2026-06-19T13:00:00.000Z",
            ended_at: "2026-06-19T17:00:00.000Z",
          },
        ],
      },
    });
  }

  it("rejects a Correction overlapping another of the worker's sessions, writing nothing", async () => {
    const client = clientWithSibling({
      started_at: "2026-06-19T08:00:00.000Z",
      ended_at: "2026-06-19T09:00:00.000Z",
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    // Correct to 12:00–14:00, which collides with the sibling 13:00–17:00.
    const res = await PATCH(
      req({ startedAt: "2026-06-19T12:00:00.000Z", endedAt: "2026-06-19T14:00:00.000Z" }),
      paramsFor(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/overlap/i);
    expect(client.rpcCalls).toHaveLength(0);
  });

  it("allows a Correction that only touches another session at an endpoint", async () => {
    const client = clientWithSibling({
      started_at: "2026-06-19T08:00:00.000Z",
      ended_at: "2026-06-19T09:00:00.000Z",
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    // Correct to 09:00–13:00 — ends exactly where the sibling (13:00–17:00)
    // starts, so it abuts without overlapping.
    const res = await PATCH(
      req({ startedAt: "2026-06-19T09:00:00.000Z", endedAt: "2026-06-19T13:00:00.000Z" }),
      paramsFor(),
    );
    expect(res.status).toBe(200);
    expect(client.rpcCalls).toHaveLength(1);
  });
});

// AC3 — a typed clock-in/out that is not a parseable instant is rejected with a
// clear 400 before any write, rather than slipping past the span check and
// failing at the database cast as a 500.
describe("PATCH /api/time/sessions/[id] — rejects malformed timestamps (#706)", () => {
  it("rejects a non-parseable clock-in, writing nothing", async () => {
    const client = leadClient();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await PATCH(req({ startedAt: "not-a-date" }), paramsFor());
    expect(res.status).toBe(400);
    expect(client.rpcCalls).toHaveLength(0);
  });
});

// AC1 — the app NEVER auto-closes an Open session. Correcting only the clock-in
// of a still-Open session leaves it Open: the route forwards a null clock-out to
// the RPC (coalesce keeps ended_at NULL), and never fabricates a close.
describe("PATCH /api/time/sessions/[id] — never auto-closes an Open session (#706)", () => {
  it("corrects only the clock-in of an Open session, leaving it Open", async () => {
    const client = leadClient({ session: { started_at: "2026-06-19T12:00:00.000Z", ended_at: null } });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const startedAt = "2026-06-19T11:30:00.000Z";
    const res = await PATCH(req({ startedAt }), paramsFor());
    expect(res.status).toBe(200);

    expect(client.rpcCalls).toHaveLength(1);
    const args = client.rpcCalls[0].args;
    expect(args.p_started_at).toBe(startedAt);
    expect(args.p_ended_at).toBeNull();
  });
});
