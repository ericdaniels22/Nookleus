import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { listOrganizationReviews } from "@/lib/google/reviews";

// GET /api/google/reviews — the Marketing Reviews inbox: this Organization's
// Google reviews, unreplied first. Admin only. Served over the service client
// (google_review is admin-only RLS; the explicit org filter in
// listOrganizationReviews keeps the read scoped). Mirrors
// /api/google/connection's guard and shape.
async function getReviews(_request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  if (!ctx.orgId) {
    return NextResponse.json({ reviews: [] });
  }
  const reviews = await listOrganizationReviews(service, ctx.orgId);
  return NextResponse.json({ reviews });
}

export const GET = withRequestContext(
  { adminOnly: true, serviceClient: true },
  getReviews,
);
