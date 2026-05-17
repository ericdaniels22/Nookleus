import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";

// POST /api/qb/sync-log/[id]/retry — manual retry of a failed row.
// Clears retry_count + error fields, flips status to 'queued'. The next
// processor tick (cron or manual sync-now) picks it up.
async function postRetry(
  _request: Request,
  ctx: RequestContext,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const service = ctx.serviceClient!;
  const { error } = await service
    .from("qb_sync_log")
    .update({
      status: "queued",
      retry_count: 0,
      next_retry_at: null,
      error_message: null,
      error_code: null,
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export const POST = withRequestContext(
  { adminOnly: true, serviceClient: true },
  postRetry,
);
