import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { getGoogleConnection, toConnectionSummary } from "@/lib/google/connection";
import { isGoogleOAuthTestingMode } from "@/lib/google/config";

// GET /api/google/connection — the token-free connection summary for the
// Settings card and the Marketing page (state, account, scopes, broken reason,
// and — while the consent screen is in Testing — the 7-day token_expires_at the
// Marketing-page countdown reads, #789). Admin only.
async function getConnection(_request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  const testingMode = isGoogleOAuthTestingMode();
  if (!ctx.orgId) {
    return NextResponse.json(toConnectionSummary(null, { testingMode }));
  }
  const conn = await getGoogleConnection(service, ctx.orgId);
  return NextResponse.json(toConnectionSummary(conn, { testingMode }));
}

export const GET = withRequestContext(
  { adminOnly: true, serviceClient: true },
  getConnection,
);
