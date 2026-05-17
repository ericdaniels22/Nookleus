import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";

// GET /api/qb/sync-log?limit=50&offset=0&status=failed
// Paginated log. Admin+manage_accounting reads; service client used so
// encrypted-token RLS on qb_connection doesn't matter here.
// Sort: failed rows first, then newest first (matches the spec's
// "Failed rows float to top" requirement on the QB tab).
async function getSyncLog(request: Request, ctx: RequestContext) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
  const status = url.searchParams.get("status"); // optional filter
  const entityType = url.searchParams.get("entity_type"); // optional filter

  const service = ctx.serviceClient!;
  let query = service
    .from("qb_sync_log")
    .select("*", { count: "exact" })
    .eq("organization_id", ctx.orgId)
    .order("status", { ascending: true }) // 'failed' < 'queued' < 'skipped_dry_run' < 'synced'
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (status) query = query.eq("status", status);
  if (entityType) query = query.eq("entity_type", entityType);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    rows: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}

export const GET = withRequestContext(
  { permission: "manage_accounting", serviceClient: true },
  getSyncLog,
);
