import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { selectNeedsAttention } from "@/lib/needs-attention";
import { loadOrganizationTimezone } from "@/lib/timesheets/load-org-timezone";

// GET /api/time/sessions/needs-attention?jobId=… — the lead's "needs attention"
// list for a Job (issue #706, AC5): the Open sessions whose elapsed time exceeds
// ~12h (the classic forgotten clock-out), across ALL workers on the Job — unlike
// the own-hours list, a lead supervises everyone. Gated on `manage_timesheets`.
//
// The amber/needs-attention state is PURELY derived from elapsed time on a
// still-Open session (selectNeedsAttention): this endpoint reads only — it never
// closes or mutates a session. RLS keeps the rows inside the caller's
// Organization, so a lead in Org A never sees Org B's sessions (AC8).
export const GET = withRequestContext(
  { permission: "manage_timesheets" },
  async (request, ctx) => {
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    // Open sessions for the Job (all workers). Org-scoped; RLS backstops it.
    const { data, error } = await ctx.supabase
      .from("time_sessions")
      .select("id, job_id, user_id, started_at, ended_at, capture_method")
      .eq("organization_id", ctx.orgId)
      .eq("job_id", jobId)
      .is("ended_at", null)
      .is("deleted_at", null)
      .order("started_at", { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const open = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      sessionId: row.id as string,
      jobId: row.job_id as string,
      userId: (row.user_id as string | null) ?? null,
      startedAt: row.started_at as string,
      endedAt: (row.ended_at as string | null) ?? null,
      // AC4 — carry the capture marker so the list flags hand-entered sessions.
      // An Open session CAN be 'hand' (only its clock-in was corrected).
      capture: (row.capture_method as string | null) ?? null,
    }));

    // The pure derivation owns the threshold and the closed-session exclusion;
    // `now` is the real clock (read once, never written back).
    const now = new Date().toISOString();
    const needsAttention = selectNeedsAttention(open, now);

    // Name each entry's worker — the list is a cross-worker entry point to a
    // Correction, so a bare user id is unusable. A separate user_profiles lookup
    // (no embedded join; one round trip for the whole page); a missing profile
    // degrades to null rather than failing the list (AC5).
    const workerIds = [
      ...new Set(needsAttention.map((s) => s.userId).filter((id): id is string => id !== null)),
    ];
    const nameById = new Map<string, string>();
    if (workerIds.length > 0) {
      const { data: profiles, error: profileError } = await ctx.supabase
        .from("user_profiles")
        .select("id, full_name")
        .in("id", workerIds);
      if (profileError) {
        return NextResponse.json({ error: profileError.message }, { status: 500 });
      }
      for (const row of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
        if (row.full_name) nameById.set(row.id, row.full_name);
      }
    }
    const sessions = needsAttention.map((s) => ({
      ...s,
      workerName: s.userId !== null ? (nameById.get(s.userId) ?? null) : null,
    }));

    // ADR 0020 — the ONE Organization timezone the client uses to display these
    // instants AND to anchor a typed Correction back to an instant. The server
    // is its authority; never the lead's device clock. UTC-fallback on no setting.
    // The manage_timesheets rule guarantees a non-null orgId on success; the
    // `?? ""` only satisfies the type (an empty id would UTC-fallback safely).
    const timeZone = await loadOrganizationTimezone(ctx.supabase, ctx.orgId ?? "");

    return NextResponse.json({ sessions, timeZone }, { status: 200 });
  },
);
