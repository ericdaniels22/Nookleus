// GET /api/estimates/trash — list trashed estimates after first auto-purging
// anything that's been trashed for more than 30 days. Mirrors
// src/app/api/jobs/trash/route.ts.
//
// Optional ?job_id=<uuid> scopes both the lazy-purge and the list to a
// single job (used by the per-job EstimatesInvoicesSection toggle).

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { purgeEstimateStorage } from "@/lib/documents/purge";
import { ESTIMATE_TRASH_WITH_JOB_HOMEOWNER_EMBED } from "@/lib/embeds/jobs-contacts";

const RETENTION_DAYS = 30;

export const GET = withRequestContext(
  { permission: "view_estimates" },
  async (request, { supabase }) => {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("job_id");

    // 1. Find anything past the 30-day window.
    const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    let expiredQuery = supabase
      .from("estimates")
      .select("id, organization_id, estimate_number")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoffIso);
    if (jobId) expiredQuery = expiredQuery.eq("job_id", jobId);
    const { data: expired } = await expiredQuery;

    // 2. Per row: write *_purged audit, run Storage cleanup, then DELETE.
    // One row at a time so a single failure doesn't strand the others.
    const { data: { user } } = await supabase.auth.getUser();
    const purgeFailures: { id: string; storageErrors: string[] }[] = [];
    for (const row of expired ?? []) {
      const { error: auditErr } = await supabase.from("contract_events").insert({
        organization_id: row.organization_id,
        contract_id: null,
        signer_id: null,
        event_type: "estimate_purged",
        metadata: {
          estimate_id: row.id,
          estimate_number: row.estimate_number,
          actor_email: user?.email ?? null,
          purged_at: new Date().toISOString(),
          reason: "auto_30d",
        },
      });
      if (auditErr) console.warn("[api] estimate_purged audit insert failed:", auditErr.message);
      const { storageErrors } = await purgeEstimateStorage(supabase, row.id);
      if (storageErrors.length > 0) purgeFailures.push({ id: row.id, storageErrors });
      await supabase.from("estimates").delete().eq("id", row.id);
    }

    // 3. List remaining trashed rows.
    let listQuery = supabase
      .from("estimates")
      .select(ESTIMATE_TRASH_WITH_JOB_HOMEOWNER_EMBED)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (jobId) listQuery = listQuery.eq("job_id", jobId);
    const { data: estimates, error } = await listQuery;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      estimates: estimates ?? [],
      autoPurged: expired?.length ?? 0,
      purgeFailures,
      retentionDays: RETENTION_DAYS,
    });
  },
);
