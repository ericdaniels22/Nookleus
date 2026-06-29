import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { deleteConnection } from "@/lib/website/connection";

// POST /api/website/disconnect — removes the Organization's stored credential.
// Unlike Google, WordPress Application Passwords have no remote revoke endpoint:
// the admin revokes the password on the WordPress side separately. Here we only
// delete our local copy so the encrypted credential never lingers. Idempotent —
// disconnecting with nothing stored is a no-op that still reports ok. Admin only.
async function postDisconnect(_request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  if (!ctx.orgId) {
    return NextResponse.json({ error: "no_active_organization" }, { status: 400 });
  }

  await deleteConnection(service, ctx.orgId);
  return NextResponse.json({ ok: true });
}

export const POST = withRequestContext(
  { adminOnly: true, serviceClient: true },
  postDisconnect,
);
