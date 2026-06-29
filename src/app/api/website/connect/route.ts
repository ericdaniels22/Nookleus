import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import {
  normalizeSiteUrl,
  validateCredential,
  isRevokedError,
} from "@/lib/website/wordpress";
import {
  getWebsiteConnection,
  upsertConnection,
  toConnectionSummary,
} from "@/lib/website/connection";
import type { WebsiteConnectionSummary } from "@/lib/website/types";

// POST /api/website/connect — the admin pastes site URL + username + Application
// Password; Save validates them against the LIVE WordPress REST API and only
// stores a credential that can actually publish posts (the AC). The password is
// handed to the store as plaintext and encrypted there — it is never written in
// the clear and never returned in the response. Admin only.
//
// Status contract:
//   400 missing_fields / invalid_site_url   — bad request body
//   422 invalid_credentials                 — WordPress rejected the password (401)
//   422 cannot_publish_posts                — credential is valid but can't write
//   502 wordpress_unreachable               — transient (5xx / network); NOT broken
//   200 + connection summary                — connected (one row per org, upserted)
async function postConnect(request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  if (!ctx.orgId) {
    return NextResponse.json({ error: "no_active_organization" }, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  // `request.json()` parses the JSON literals `null`, arrays, and primitives
  // without throwing — guard the shape before reading fields, or `null.siteUrl`
  // crashes the handler into an unhandled 500 instead of the contracted 400.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const body = parsed as {
    siteUrl?: unknown;
    username?: unknown;
    applicationPassword?: unknown;
  };

  const siteUrlRaw = typeof body.siteUrl === "string" ? body.siteUrl.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  // Trim only surrounding whitespace — WordPress Application Passwords contain
  // internal spaces by design, which Basic auth carries verbatim.
  const applicationPassword =
    typeof body.applicationPassword === "string" ? body.applicationPassword.trim() : "";
  if (!siteUrlRaw || !username || !applicationPassword) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  let siteUrl: string;
  try {
    siteUrl = normalizeSiteUrl(siteUrlRaw);
  } catch {
    return NextResponse.json({ error: "invalid_site_url" }, { status: 400 });
  }

  let check;
  try {
    check = await validateCredential({ siteUrl, username, applicationPassword });
  } catch (err) {
    // A 401 means the credential is wrong/revoked — reject it. Anything else
    // (5xx, network) is transient: report unreachable, never store, never break.
    if (isRevokedError(err)) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 422 });
    }
    return NextResponse.json({ error: "wordpress_unreachable" }, { status: 502 });
  }

  if (!check.canPublishPosts) {
    return NextResponse.json({ error: "cannot_publish_posts" }, { status: 422 });
  }

  const { error } = await upsertConnection(service, {
    organizationId: ctx.orgId,
    provider: "wordpress",
    siteUrl,
    username,
    applicationPassword,
    accountName: check.accountName,
    connectedBy: ctx.userId,
  });
  if (error) {
    return NextResponse.json({ error: "db_write_failed" }, { status: 500 });
  }

  // The write succeeded, so the connection IS connected. Re-read for the
  // canonical row (id, timestamps); but getWebsiteConnection swallows a transient
  // read error and returns null, and toConnectionSummary(null) is a DISCONNECTED
  // summary — returning that on a 200 would make the card announce "connected"
  // yet flip back to the empty form for a credential that was actually stored.
  // Fall back to a connected summary built from what we just wrote.
  const conn = await getWebsiteConnection(service, ctx.orgId);
  if (conn) {
    return NextResponse.json(toConnectionSummary(conn));
  }
  return NextResponse.json({
    state: "connected",
    provider: "wordpress",
    site_url: siteUrl,
    username,
    account_name: check.accountName,
    broken_reason: null,
    connected_at: null,
  } satisfies WebsiteConnectionSummary);
}

export const POST = withRequestContext(
  { adminOnly: true, serviceClient: true },
  postConnect,
);
