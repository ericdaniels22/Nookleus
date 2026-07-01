import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { QUICK_PICK_LABEL_MAX_LENGTH } from "@/lib/types";

// Validate one label's text: trim, require non-empty, cap the length. Returns
// the cleaned text or a reason. Shared by POST and both PUT branches so the
// single-edit and bulk-reorder paths enforce identical rules (#857).
function parseLabel(raw: unknown): { label: string } | { error: string } {
  const label = typeof raw === "string" ? raw.trim() : "";
  if (!label) return { error: "label is required" };
  if (label.length > QUICK_PICK_LABEL_MAX_LENGTH) {
    return {
      error: `label must be ${QUICK_PICK_LABEL_MAX_LENGTH} characters or fewer`,
    };
  }
  return { label };
}

// Quick-pick labels (#819) — reusable phrases an org saves so a user can later
// tap one to apply as a Label on an Annotation. GET serves NULL-org shared
// defaults plus the active org's own rows; POST always inserts an org-owned row.
//
// POST (managing the catalogue) stays `access_settings`. GET is also read by
// the photo annotator to offer Quick-pick options (#821), so it admits either
// `access_settings` (the Settings Photos tab) or `edit_photos` (anyone who can
// annotate) — without `edit_photos` the feature would be invisible to the field
// users who actually do the annotating.

// GET /api/settings/quick-pick-labels — NULL-org defaults plus this org's rows.
export const GET = withRequestContext(
  { permission: ["access_settings", "edit_photos"] },
  async (_request, ctx) => {
    const orgId = ctx.orgId;
    const { data, error } = await ctx.supabase
      .from("quick_pick_labels")
      .select("*")
      .or(`organization_id.is.null,organization_id.eq.${orgId}`)
      .order("sort_order");

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
);

// POST /api/settings/quick-pick-labels — create a new (always org-owned) label.
export const POST = withRequestContext({ permission: "access_settings" }, async (request, ctx) => {
  const body = await request.json();
  const parsed = parseLabel(body.label);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const label = parsed.label;

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

  if (error) {
    // 23505 = unique_violation on the (organization_id, label) key (#857) —
    // report the duplicate plainly instead of leaking the Postgres message.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A quick-pick label with that text already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
});

// PUT /api/settings/quick-pick-labels — edit one label's text (single object)
// or bulk-reorder the org's rows (array). Every write is scoped to the active
// org, so a request targeting another org's row or a NULL-org default makes no
// change. Mirrors the damage-types route shape.
export const PUT = withRequestContext({ permission: "access_settings" }, async (request, ctx) => {
  const body = await request.json();
  const orgId = ctx.orgId;

  // Bulk reorder: one update per row, each scoped to the active org. Validate
  // every item up front (same rule as the single edit) so one blank label
  // rejects the whole batch and writes nothing (#857).
  if (Array.isArray(body)) {
    const cleaned: { id: unknown; label: string; sort_order: unknown }[] = [];
    for (const item of body) {
      const parsed = parseLabel(item.label);
      if ("error" in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      cleaned.push({ id: item.id, label: parsed.label, sort_order: item.sort_order });
    }

    for (const item of cleaned) {
      const { error } = await ctx.supabase
        .from("quick_pick_labels")
        .update({ label: item.label, sort_order: item.sort_order })
        .eq("id", item.id)
        .eq("organization_id", orgId);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  // Single inline edit: save the new (trimmed) label text and its position.
  const id = body.id;
  const parsed = parseLabel(body.label);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const label = parsed.label;

  const { error } = await ctx.supabase
    .from("quick_pick_labels")
    .update({ label, sort_order: body.sort_order })
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
});

// DELETE /api/settings/quick-pick-labels?id=xxx — remove an org-owned label.
// The shared NULL-org defaults are protected (403); the org filter on the
// delete keeps a caller from removing another org's row.
export const DELETE = withRequestContext({ permission: "access_settings" }, async (request, ctx) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const orgId = ctx.orgId;

  const { data: row } = await ctx.supabase
    .from("quick_pick_labels")
    .select("organization_id")
    .eq("id", id)
    .maybeSingle();

  // A NULL-org row is a shared default — visible to every org, owned by none.
  if (row && row.organization_id === null) {
    return NextResponse.json(
      { error: "Default quick-pick labels cannot be deleted" },
      { status: 403 }
    );
  }

  const { error } = await ctx.supabase
    .from("quick_pick_labels")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
});
