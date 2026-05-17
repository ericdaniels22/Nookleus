// POST /api/qb/sync-log/cleanup
// Deletes synced rows older than 90 days. Keeps failed/queued rows
// regardless of age. Admin only.

import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";

async function postCleanup(_request: Request, ctx: RequestContext) {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const service = ctx.serviceClient!;
  const { error, count } = await service
    .from("qb_sync_log")
    .delete({ count: "exact" })
    .in("status", ["synced", "skipped_dry_run"])
    .lt("synced_at", cutoff);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}

export const POST = withRequestContext(
  { adminOnly: true, serviceClient: true },
  postCleanup,
);
