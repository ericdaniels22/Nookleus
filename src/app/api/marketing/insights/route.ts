import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { listOrganizationInsights } from "@/lib/insights/metrics-store";
import { toDailySeries } from "@/lib/insights/series";

// GET /api/marketing/insights — the Insights screen's day-level history for this
// Organization, both sources. Admin only. Served over the service client
// (insight_metric is admin-only RLS; the explicit org filter in
// listOrganizationInsights keeps the read scoped). The flat store rows are folded
// into one ascending day series per (source, metric). Mirrors /api/google/reviews.
async function getInsights(_request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  if (!ctx.orgId) {
    return NextResponse.json({ series: [] });
  }
  const rows = await listOrganizationInsights(service, ctx.orgId);
  return NextResponse.json({ series: toDailySeries(rows) });
}

export const GET = withRequestContext(
  { adminOnly: true, serviceClient: true },
  getInsights,
);
