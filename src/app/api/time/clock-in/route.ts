import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { planClockIn } from "@/lib/session-lifecycle";
import { loadOpenSession } from "@/lib/time-sessions";

// POST /api/time/clock-in — clock the caller in to a Job (issue #701).
// Gated on `track_time`.
export const POST = withRequestContext(
  { permission: "track_time" },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as
      | { jobId?: string; takenAt?: string; clientCaptureId?: string; sessionId?: string }
      | null;
    if (!body?.jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    // The recorded session start is the device tap instant when the client sends
    // one (the offline path device-stamps `takenAt`; device time is authoritative
    // for the tap instant, #702). An online direct tap omits it, so the server
    // stamps the instant in UTC as the fallback. Either way it is a UTC instant;
    // hours are still classified server-side against the Org timezone (ADR 0020),
    // never the device clock.
    const at = body.takenAt ?? new Date().toISOString();

    // Load the worker's current Open session and let the pure lifecycle rules
    // decide the action.
    const open = await loadOpenSession(ctx.supabase, ctx.userId, ctx.orgId);

    const plan = planClockIn(open, { jobId: body.jobId, at });

    if (plan.type === "already-open" && open) {
      // Already On the clock for this Job — nothing to write.
      return NextResponse.json(
        { sessionId: open.sessionId, jobId: open.jobId, startedAt: open.startedAt, alreadyOpen: true },
        { status: 200 },
      );
    }

    // A `switch` carries the prior session to close in the same atomic RPC, so
    // the worker is never On the clock for two Jobs (nor for none) mid-switch.
    const switched = plan.type === "switch";
    // Design A: the device commits to the session id at tap time (the offline
    // path generates it so a queued clock-out can name it before the clock-in
    // ever syncs). clock_in_to_job inserts the row with id = p_session_id. An
    // online direct tap omits it, so the server proposes one as the fallback.
    const proposedId = body.sessionId ?? randomUUID();
    const { data, error } = await ctx.supabase.rpc("clock_in_to_job", {
      p_session_id: proposedId,
      p_organization_id: ctx.orgId,
      p_job_id: body.jobId,
      p_user_id: ctx.userId,
      p_started_at: at,
      p_actor: ctx.userId,
      p_close_session_id: switched ? plan.close.sessionId : null,
      p_close_ended_at: switched ? plan.close.endedAt : null,
      // The idempotency key (offline path only). A replay of the same tap returns
      // the original session instead of opening a second one (#702). Null for an
      // online direct tap, which keeps the slice-1 behavior.
      p_client_capture_id: body.clientCaptureId ?? null,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // The RPC returns the authoritative session id — the freshly inserted one,
    // or the ORIGINAL on an idempotent replay (which differs from what we just
    // proposed). Report that, so a retried tap names the real session (#702).
    const sessionId = (typeof data === "string" && data) ? data : proposedId;

    return NextResponse.json(
      switched
        ? { sessionId, jobId: body.jobId, startedAt: at, switched: true, closedJobId: open!.jobId }
        : { sessionId, jobId: body.jobId, startedAt: at, switched: false },
      { status: 201 },
    );
  },
);
