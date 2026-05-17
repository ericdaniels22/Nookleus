// GET /api/jobs/trash — list jobs currently in the trash, after first
// auto-purging anything that has been trashed for more than 30 days
// (lazy purge, per the design decision in #33).
//
// Auth: same rule as /api/jobs/[id]/delete — admin or office_staff only.
// Crew members never see the trash UI, so this endpoint should only be
// hit by callers that already have the right role; we still enforce it
// defensively.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { purgeJobStorage } from "@/lib/jobs/purge";

const RETENTION_DAYS = 30;

export const GET = withRequestContext(
  { roles: ["admin", "office_staff"] },
  async (_request, ctx) => {
    const supabase = ctx.supabase;

    // 1. Find anything past the 30-day window in the caller's org.
    // RLS scopes this to the active organization, so we only see and only
    // touch rows the caller is allowed to manage.
    const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: expired } = await supabase
      .from("jobs")
      .select("id")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoffIso);

    // 2. For each expired row: clear storage, then hard-delete (cascade
    // takes the rest). One job at a time so a single failure doesn't strand
    // the others. Storage errors are logged on the response but do not
    // block the SQL delete — orphan storage objects are recoverable, but
    // a half-deleted job row in the trash is not.
    const purgeFailures: { jobId: string; storageErrors: string[] }[] = [];
    for (const row of expired ?? []) {
      const { storageErrors } = await purgeJobStorage(supabase, row.id);
      if (storageErrors.length > 0) {
        purgeFailures.push({ jobId: row.id, storageErrors });
      }
      await supabase.from("jobs").delete().eq("id", row.id);
    }

    // 3. List what's left in the trash.
    const { data: trashed, error } = await supabase
      .from("jobs")
      .select("*, contact:contacts!contact_id(*)")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      jobs: trashed ?? [],
      autoPurged: expired?.length ?? 0,
      purgeFailures,
      retentionDays: RETENTION_DAYS,
    });
  },
);
