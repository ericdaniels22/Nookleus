import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// Quick-pick labels (#819) — reusable phrases an org saves so a user can later
// tap one to apply as a Label on an Annotation. Mirrors the damage-types
// catalog: both methods require `access_settings`, GET serves NULL-org shared
// defaults plus the active org's own rows, POST always inserts an org-owned row.

// GET /api/settings/quick-pick-labels — NULL-org defaults plus this org's rows.
export const GET = withRequestContext({ permission: "access_settings" }, async (_request, ctx) => {
  const orgId = ctx.orgId;
  const { data, error } = await ctx.supabase
    .from("quick_pick_labels")
    .select("*")
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order("sort_order");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
});

// POST /api/settings/quick-pick-labels — create a new (always org-owned) label.
export const POST = withRequestContext({ permission: "access_settings" }, async (request, ctx) => {
  const body = await request.json();
  const label = typeof body.label === "string" ? body.label.trim() : "";

  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  const orgId = ctx.orgId;

  // Append after the last visible label (shared defaults + this org's rows).
  const { data: existing } = await ctx.supabase
    .from("quick_pick_labels")
    .select("sort_order")
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1;

  const { data, error } = await ctx.supabase
    .from("quick_pick_labels")
    .insert({ organization_id: orgId, label, sort_order: nextOrder })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
});
