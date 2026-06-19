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
    const body = (await request.json().catch(() => null)) as { jobId?: string } | null;
    if (!body?.jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    // Server stamps the instant in UTC (ADR 0020) — never trust a client clock.
    const at = new Date().toISOString();

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
    const sessionId = randomUUID();
    const { error } = await ctx.supabase.rpc("clock_in_to_job", {
      p_session_id: sessionId,
      p_organization_id: ctx.orgId,
      p_job_id: body.jobId,
      p_user_id: ctx.userId,
      p_started_at: at,
      p_actor: ctx.userId,
      p_close_session_id: switched ? plan.close.sessionId : null,
      p_close_ended_at: switched ? plan.close.endedAt : null,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      switched
        ? { sessionId, jobId: body.jobId, startedAt: at, switched: true, closedJobId: open!.jobId }
        : { sessionId, jobId: body.jobId, startedAt: at, switched: false },
      { status: 201 },
    );
  },
);
