import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { listConnectedOrganizationIds } from "@/lib/google/connection";
import { syncAllConnectedReviews } from "@/lib/google/reviews";
import { getGoogleClient } from "@/lib/google/client";

// GET /api/google/reviews/sync-scheduled — Vercel Cron endpoint. Runs daily
// (Hobby plan cap), like /api/qb/sync-scheduled, and authenticates the same
// way: Authorization: Bearer <CRON_SECRET>. Fans out over every connected
// Organization, syncing each in isolation (a broken connection is skipped, a
// throwing one is counted failed but never aborts the run — see
// syncAllConnectedReviews). Everything runs over the privileged service client:
// the cron has no user session, and google_review / google_connection are
// admin-only RLS.
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
  const organizationIds = await listConnectedOrganizationIds(service);
  const result = await syncAllConnectedReviews({
    db: service,
    organizationIds,
    getClient: (organizationId) => getGoogleClient(service, organizationId),
  });
  const durationMs = Date.now() - startedAt;
  console.log(
    `[google-reviews-sync-scheduled] organizations=${result.organizations} synced=${result.synced} skipped=${result.skipped} failed=${result.failed} reviewsSynced=${result.reviewsSynced} durationMs=${durationMs}`,
  );
  return NextResponse.json({ ok: true, ...result, durationMs });
}
