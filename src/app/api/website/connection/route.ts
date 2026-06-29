import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import {
  getWebsiteConnection,
  toConnectionSummary,
} from "@/lib/website/connection";

// GET /api/website/connection — the credential-free connection summary the
// Settings card renders (state, site, account, broken reason). The Application
// Password never appears here; toConnectionSummary omits it by construction.
// Admin only.
async function getConnection(_request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  if (!ctx.orgId) {
    return NextResponse.json(toConnectionSummary(null));
  }
  const conn = await getWebsiteConnection(service, ctx.orgId);
  return NextResponse.json(toConnectionSummary(conn));
}

export const GET = withRequestContext(
  { adminOnly: true, serviceClient: true },
  getConnection,
);
