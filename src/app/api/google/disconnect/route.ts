import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { getGoogleConnection, deleteConnection } from "@/lib/google/connection";
import { revokeToken } from "@/lib/google/oauth";
import { decrypt } from "@/lib/encryption";

// POST /api/google/disconnect — revokes the credential at Google, then deletes
// the row. Unlike qb (which retains an inactive row for audit), the Google
// credential is fully removed so nothing lingers locally after disconnect. The
// revoke is best-effort: if Google is unreachable we still delete, so a user can
// always sever the link from their side.
async function postDisconnect(_request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  if (!ctx.orgId) {
    return NextResponse.json({ error: "no active organization" }, { status: 400 });
  }

  const conn = await getGoogleConnection(service, ctx.orgId);
  if (conn) {
    try {
      await revokeToken(decrypt(conn.refresh_token_encrypted));
    } catch {
      // best-effort — proceed to delete regardless.
    }
    await deleteConnection(service, ctx.orgId);
  }
  return NextResponse.json({ ok: true });
}

export const POST = withRequestContext(
  { adminOnly: true, serviceClient: true },
  postDisconnect,
);
