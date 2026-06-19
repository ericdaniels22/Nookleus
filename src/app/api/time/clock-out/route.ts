import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { planClockOut } from "@/lib/session-lifecycle";
import { loadOpenSession } from "@/lib/time-sessions";

// POST /api/time/clock-out — clock the caller out of their Open Job (issue #701).
// Gated on `track_time`.
export const POST = withRequestContext(
  { permission: "track_time" },
  async (_request, ctx) => {
    // Server stamps the instant in UTC (ADR 0020) — never trust a client clock.
    const at = new Date().toISOString();

    // Load the worker's current Open session and let the pure lifecycle rules
    // decide whether there is anything to close.
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
