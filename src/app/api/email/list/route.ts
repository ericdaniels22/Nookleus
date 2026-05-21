import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { resolveEmailAccountAccess } from "@/lib/email/email-account-access-for-route";

// GET /api/email/list?folder=inbox&accountId=...&search=...&page=1&limit=50
// Gated on view_email; when an `accountId` is supplied the route additionally
// confirms canRead on that specific account through the access module
// (#141, ADR 0001). With no accountId, the route lists across every account
// the caller can see — RLS keeps Personal accounts the caller does not own
// out of the result set, so the visible-set is correctly scoped.
export const GET = withRequestContext(
  { permission: "view_email", serviceClient: true },
  async (request, ctx) => {
  const { searchParams } = new URL(request.url);
  const folder = searchParams.get("folder") || "inbox";
  const accountId = searchParams.get("accountId"); // null = all accounts

  if (accountId) {
    const resolved = await resolveEmailAccountAccess(
      ctx.serviceClient!,
      accountId,
      ctx,
      "canRead",
    );
    if (resolved.kind === "response") return resolved.response;
  }

  const search = searchParams.get("search") || "";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const starred = searchParams.get("starred");
  const category = searchParams.get("category");

  const offset = (page - 1) * limit;

  let query = ctx.supabase
    .from("emails")
    .select("*, job:jobs(id, job_number, property_address)", { count: "exact" });

  // Filter by folder (unless showing starred across all folders)
  if (starred === "true") {
    query = query.eq("is_starred", true);
  } else {
    query = query.eq("folder", folder);
  }

  // Filter by account
  if (accountId) {
    query = query.eq("account_id", accountId);
  }

  // Filter by category (only applies to inbox). "starred" is a pseudo-category
  // that filters the inbox to starred emails only.
  if (category && folder === "inbox" && starred !== "true") {
    if (category === "starred") {
      query = query.eq("is_starred", true);
    } else {
      query = query.eq("category", category);
    }
  }

  // Search in subject, from_address, from_name, snippet
  if (search) {
    query = query.or(
      `subject.ilike.%${search}%,from_address.ilike.%${search}%,from_name.ilike.%${search}%,snippet.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query
    .order("received_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    emails: data || [],
    total: count || 0,
    page,
    limit,
    hasMore: (count || 0) > offset + limit,
  });
});
