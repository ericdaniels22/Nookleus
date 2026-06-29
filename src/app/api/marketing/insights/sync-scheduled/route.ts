import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { listConnectedOrganizationIds } from "@/lib/google/connection";
import { ingestAllConnectedInsights } from "@/lib/insights/ingest";
import { getGoogleClient } from "@/lib/google/client";

// GET /api/marketing/insights/sync-scheduled — Vercel Cron endpoint. Runs daily
// (Hobby plan cap), like /api/google/reviews/sync-scheduled, and authenticates
// the same way: Authorization: Bearer <CRON_SECRET>. Fans out over every
// connected Organization, ingesting Business Profile performance + Search
// Console for the trailing window and upserting idempotently (a broken
// connection is skipped, a throwing one is counted failed but never aborts the
// run — see ingestAllConnectedInsights). Everything runs over the privileged
// service client: the cron has no user session, and insight_metric /
// google_connection are admin-only RLS.
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const service = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const organizationIds = await listConnectedOrganizationIds(service);
  const result = await ingestAllConnectedInsights({
    db: service,
    organizationIds,
    today,
    getClient: (organizationId) => getGoogleClient(service, organizationId),
  });
  const durationMs = Date.now() - startedAt;
  console.log(
    `[marketing-insights-sync-scheduled] organizations=${result.organizations} synced=${result.synced} skipped=${result.skipped} failed=${result.failed} metricsSynced=${result.metricsSynced} durationMs=${durationMs}`,
  );
  return NextResponse.json({ ok: true, ...result, durationMs });
}
