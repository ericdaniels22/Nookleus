import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { validateCorrectedSpan } from "@/lib/session-lifecycle";

// PATCH /api/time/sessions/[id] — a lead/admin Correction of a recorded Time
// session's clock-in and/or clock-out (issue #706). Gated on `manage_timesheets`
// (NOT track_time) — a worker self-clocks but can never type or edit a time
// (CONTEXT.md "Correction"). The body carries the real times a human typed; the
// app never pre-fills, rounds, or auto-closes (ADR 0019).
//
// The atomic correct_time_session RPC performs the decided write — set the
// corrected times, flip capture_method to 'hand' — and appends the one
// append-only 'corrected' audit event in a single statement (mirrors
// clock_out_session in migration-661).
export const PATCH = withRequestContext(
  { permission: "manage_timesheets" },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { startedAt?: string; endedAt?: string }
      | null;

    const startedAt = body?.startedAt ?? null;
    const endedAt = body?.endedAt ?? null;
    if (startedAt === null && endedAt === null) {
      return NextResponse.json(
        { error: "a Correction must change the clock-in or clock-out time" },
        { status: 400 },
      );
    }

    // A typed time that isn't a parseable instant is rejected up front with a
    // clear 400 (AC3) — without this, a non-ISO string slips past the span check
    // (NaN comparisons are false) and only fails at the timestamptz cast inside
    // the RPC, surfacing as a 500 with a raw database message.
    for (const [field, value] of [
      ["startedAt", startedAt],
      ["endedAt", endedAt],
    ] as const) {
      if (value !== null && Number.isNaN(Date.parse(value))) {
        return NextResponse.json(
          { error: `${field} must be a valid timestamp` },
          { status: 400 },
        );
      }
    }

    // Load the targeted session to validate the Correction against its stored
    // times (the lead may be editing only one end) and to refuse an unknown
    // session. RLS + the org filter keep this inside the caller's Organization,
    // so a session in another Org reads as "not found" (AC8).
    const { data: existing } = await ctx.supabase
      .from("time_sessions")
      .select("started_at, ended_at, user_id")
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    const row = existing as {
      started_at: string;
      ended_at: string | null;
      user_id: string;
    };

    // Reject an impossible span BEFORE any write (AC3). The effective span is the
    // corrected end against the corrected-or-existing start (and vice versa). An
    // Open session with no corrected clock-out has no end to validate — and the
    // app NEVER fabricates one (AC1), so it stays Open. A bad span never reaches
    // the database, so no event is appended and capture_method is unchanged.
    const effStart = startedAt ?? row.started_at;
    const effEnd = endedAt ?? row.ended_at;
    if (effEnd !== null) {
      // A worker is On the clock for at most one Job at a time, so their recorded
      // spans must never overlap (AC3's "overlapping"). Load the worker's OTHER
      // closed sessions in this Org and reject a Correction that would collide
      // with one — Open and soft-deleted sessions don't bound a span.
      const { data: otherRows } = await ctx.supabase
        .from("time_sessions")
        .select("started_at, ended_at")
        .eq("organization_id", ctx.orgId)
        .eq("user_id", row.user_id)
        .is("deleted_at", null)
        .not("id", "eq", id)
        .not("ended_at", "is", null);
      const others = ((otherRows ?? []) as {
        started_at: string;
        ended_at: string;
      }[]).map((r) => ({ startedAt: r.started_at, endedAt: r.ended_at }));

      const problem = validateCorrectedSpan(
        { startedAt: effStart, endedAt: effEnd },
        others,
      );
      if (problem !== null) {
        return NextResponse.json(
          {
            error:
              problem === "overlap"
                ? "this span overlaps another of the worker's recorded sessions"
                : "clock-out must be after clock-in",
          },
          { status: 400 },
        );
      }
    }

    const { error } = await ctx.supabase.rpc("correct_time_session", {
      p_session_id: id,
      p_organization_id: ctx.orgId,
      p_started_at: startedAt,
      p_ended_at: endedAt,
      p_actor: ctx.userId,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ corrected: true, sessionId: id }, { status: 200 });
  },
);
