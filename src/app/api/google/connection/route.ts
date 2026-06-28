import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { getGoogleConnection, toConnectionSummary } from "@/lib/google/connection";

// GET /api/google/connection — the token-free connection summary for the
// Settings card (state, account, scopes, broken reason). Admin only.
async function getConnection(_request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  if (!ctx.orgId) {
    return NextResponse.json(toConnectionSummary(null));
  }
  const conn = await getGoogleConnection(service, ctx.orgId);
  return NextResponse.json(toConnectionSummary(conn));
}

export const GET = withRequestContext(
  { adminOnly: true, serviceClient: true },
  getConnection,
);
