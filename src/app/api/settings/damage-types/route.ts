import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// All four methods are logged-in only — previously ungated (recorded for the
// #78 ungated-endpoint list).

// GET /api/settings/damage-types — NULL-org defaults plus this org's rows.
export const GET = withRequestContext({}, async (_request, ctx) => {
  const orgId = ctx.orgId;
  const { data, error } = await ctx.supabase
    .from("damage_types")
    .select("*")
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order("sort_order");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
});

// POST /api/settings/damage-types — create new (always org-owned) type.
export const POST = withRequestContext({}, async (request, ctx) => {
  const body = await request.json();
  const { name, display_label, bg_color, text_color, icon } = body;

  if (!name || !display_label) {
    return NextResponse.json({ error: "name and display_label are required" }, { status: 400 });
  }

  const orgId = ctx.orgId;

  const { data: existing } = await ctx.supabase
    .from("damage_types")
    .select("sort_order")
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1;

  const { data, error } = await ctx.supabase
    .from("damage_types")
    .insert({
      organization_id: orgId,
      name: name.toLowerCase().replace(/\s+/g, "_"),
      display_label,
      bg_color: bg_color || "#F1EFE8",
      text_color: text_color || "#5F5E5A",
      icon: icon || null,
      sort_order: nextOrder,
      is_default: false,
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes("duplicate")) {
      return NextResponse.json({ error: "A damage type with that name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
});

// PUT /api/settings/damage-types — bulk update, active-org rows only.
export const PUT = withRequestContext({}, async (request, ctx) => {
  const body = await request.json();
  const orgId = ctx.orgId;

  if (Array.isArray(body)) {
    for (const item of body) {
      const { error } = await ctx.supabase
        .from("damage_types")
        .update({
          display_label: item.display_label,
          bg_color: item.bg_color,
          text_color: item.text_color,
          icon: item.icon,
          sort_order: item.sort_order,
        })
        .eq("id", item.id)
        .eq("organization_id", orgId);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  const { id, display_label, bg_color, text_color, icon, sort_order } = body;
  const { error } = await ctx.supabase
    .from("damage_types")
    .update({ display_label, bg_color, text_color, icon, sort_order })
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
});

// DELETE /api/settings/damage-types?id=xxx
export const DELETE = withRequestContext({}, async (request, ctx) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const orgId = ctx.orgId;

  const { data: dtype } = await ctx.supabase
    .from("damage_types")
    .select("is_default, name, organization_id")
    .eq("id", id)
    .single();

  if (dtype?.is_default || dtype?.organization_id === null) {
    return NextResponse.json({ error: "Default damage types cannot be deleted" }, { status: 403 });
  }

  const { count } = await ctx.supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("damage_type", dtype?.name || "");

  if (count && count > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} job(s) use this damage type` },
      { status: 409 }
    );
  }

  const { error } = await ctx.supabase
    .from("damage_types")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
});
