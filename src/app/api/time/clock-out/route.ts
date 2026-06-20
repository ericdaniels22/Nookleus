import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { planClockOut } from "@/lib/session-lifecycle";
import { loadOpenSession } from "@/lib/time-sessions";

// POST /api/time/clock-out — clock the caller out of their Open Job (issue #701).
// Gated on `track_time`.
export const POST = withRequestContext(
  { permission: "track_time" },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as
      | { sessionId?: string; takenAt?: string; clientCaptureId?: string }
      | null;

    // The recorded end is the device tap instant when the client sends one (the
    // offline path device-stamps `takenAt`; device time is authoritative for the
    // tap instant, #702). A live tap omits it, so the server stamps the instant
    // in UTC as the fallback. Hours are still classified server-side against the
    // Org timezone (ADR 0020), never the device clock.
    const at = body?.takenAt ?? new Date().toISOString();

    // A queued offline tap names the ORIGINAL session it was tapped for: close
    // THAT session, even if the worker has since clocked into a different Job.
    // The clientCaptureId makes it idempotent server-side — a replay, or a late
    // tap against a session a lead already resolved, is a no-op, never a
    // back-date (#702, AC2/AC8). No need to load the current Open session.
    if (body?.sessionId) {
      const { error } = await ctx.supabase.rpc("clock_out_session", {
        p_session_id: body.sessionId,
        p_organization_id: ctx.orgId,
        p_ended_at: at,
        p_actor: ctx.userId,
        p_client_capture_id: body.clientCaptureId ?? null,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json(
        { closed: true, sessionId: body.sessionId, endedAt: at },
        { status: 200 },
      );
    }

    // Live clock-out (no named session): load the worker's current Open session
    // and let the pure lifecycle rules decide whether there is anything to close.
    const open = await loadOpenSession(ctx.supabase, ctx.userId, ctx.orgId);

    const plan = planClockOut(open, at);

    if (plan.type === "nothing-open" || !open) {
      // Idempotent — clocking out with nothing Open is a no-op, not an error.
      return NextResponse.json({ closed: false }, { status: 200 });
    }

    const { error } = await ctx.supabase.rpc("clock_out_session", {
      p_session_id: plan.sessionId,
      p_organization_id: ctx.orgId,
      p_ended_at: plan.endedAt,
      p_actor: ctx.userId,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { closed: true, sessionId: open.sessionId, jobId: open.jobId, endedAt: plan.endedAt },
      { status: 200 },
    );
  },
);
