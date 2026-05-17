import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";

// POST /api/qb/disconnect — mark all active connections inactive. We keep
// the encrypted tokens on the row for audit; a future reconnect creates a
// new row rather than reviving the old one.
async function postDisconnect(_request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  const { error } = await service
    .from("qb_connection")
    .update({ is_active: false })
    .eq("is_active", true)
    .eq("organization_id", ctx.orgId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export const POST = withRequestContext(
  { adminOnly: true, serviceClient: true },
  postDisconnect,
);
