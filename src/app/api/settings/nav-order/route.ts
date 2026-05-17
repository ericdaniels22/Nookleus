import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/settings/nav-order — returns the admin-configured order.
// Any signed-in user can read (RLS enforces this).
// Logged-in only — previously ungated (recorded for the #78 ungated list).
export const GET = withRequestContext({}, async (_request, ctx) => {
  const { data, error } = await ctx.supabase
    .from("nav_items")
    .select("href, sort_order")
    .order("sort_order");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
});

// PUT /api/settings/nav-order — admin-only. Body: { order: string[] }
// where `order` is an array of hrefs in the desired display order.
// Upserts each href with sort_order = index + 1.
//
// nav_items is a product-level table, so the admin check accepts admin in
// ANY org the caller belongs to — not just the Active Organization. The
// wrapper's `adminOnly` rule only checks the Active Organization, so this
// route stays logged-in-only at the wrapper and keeps the any-org admin
// check as its own business logic (matching the build48 RLS policy).
export const PUT = withRequestContext({}, async (request, ctx) => {
  // Admin check (defense-in-depth; RLS also enforces this). nav_items is a
  // product-level table, so we accept admin in ANY org the user belongs to.
  const { data: anyAdminMembership } = await ctx.supabase
    .from("user_organizations")
    .select("id")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!anyAdminMembership) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  // Validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const order = (body as { order?: unknown })?.order;
  if (!Array.isArray(order)) {
    return NextResponse.json(
      { error: "order must be an array" },
      { status: 400 }
    );
  }
  for (const href of order) {
    if (typeof href !== "string" || href.length === 0) {
      return NextResponse.json(
        { error: "order must contain non-empty strings" },
        { status: 400 }
      );
    }
  }

  // Upsert each href with its new sort_order
  const rows = (order as string[]).map((href, i) => ({
    href,
    sort_order: i + 1,
  }));

  const { error } = await ctx.supabase
    .from("nav_items")
    .upsert(rows, { onConflict: "href" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
});
