import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { processQueue } from "@/lib/qb/sync/processor";

// POST /api/qb/sync-now — manual trigger from the "Sync now" button on
// the QB tab. Runs the same processor the cron uses; returns the result
// so the UI can refresh stat cards and show a toast.
async function postSyncNow(_request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  const result = await processQueue(service);
  return NextResponse.json(result);
}

export const POST = withRequestContext(
  { adminOnly: true, serviceClient: true },
  postSyncNow,
);
