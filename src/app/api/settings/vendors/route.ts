import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET — list, any authenticated user (used by the Log Expense modal
// autocomplete too). Reads vendors with the Service client.
export const GET = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";
    const active = searchParams.get("active");
    const type = searchParams.get("type");
    const is1099 = searchParams.get("is_1099");

    let query = ctx
      .serviceClient!.from("vendors")
      .select("*, default_category:expense_categories!default_category_id(id, display_label, bg_color, text_color)")
      .eq("organization_id", ctx.orgId)
      .order("name", { ascending: true });

    if (q) query = query.ilike("name", `%${q}%`);
    if (active === "true") query = query.eq("is_active", true);
    if (active === "false") query = query.eq("is_active", false);
    if (type) query = query.eq("vendor_type", type);
    if (is1099 === "true") query = query.eq("is_1099", true);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  },
);

// POST — create. Quick-add (vendor_type=other, minimal fields) requires the
// `log_expenses` permission; full creates require `manage_vendors`. Because
// the required key depends on the request body — and the two are disjoint
// requirements the static rule cannot express — the wrapper's rule admits
// either key (a coarse pre-filter that still 401s / 403s a caller holding
// neither) and the route re-checks the exact key as its own business logic.
// Admins always pass.
export const POST = withRequestContext(
  { permission: ["log_expenses", "manage_vendors"], serviceClient: true },
  async (request, ctx) => {
    const body = await request.json();
    const { name, vendor_type, default_category_id, is_1099, tax_id, notes } = body as Record<string, unknown>;

    const quickAdd =
      vendor_type === "other" &&
      (default_category_id == null) &&
      !is_1099 &&
      (tax_id == null || tax_id === "") &&
      (notes == null || notes === "");

    // Narrow the wrapper's either-key admission to the exact key this
    // request needs. Admins always pass.
    const neededKey = quickAdd ? "log_expenses" : "manage_vendors";
    if (ctx.role !== "admin") {
      const { data: membership } = await ctx.supabase
        .from("user_organizations")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("organization_id", ctx.orgId)
        .maybeSingle<{ id: string }>();
      const { data: grant } = membership
        ? await ctx.supabase
            .from("user_organization_permissions")
            .select("granted")
            .eq("user_organization_id", membership.id)
            .eq("permission_key", neededKey)
            .maybeSingle<{ granted: boolean }>()
        : { data: null };
      if (grant?.granted !== true) {
        return NextResponse.json({ error: "Permission denied" }, { status: 403 });
      }
    }

    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const allowedTypes = ["supplier", "subcontractor", "equipment_rental", "fuel", "other"];
    if (typeof vendor_type !== "string" || !allowedTypes.includes(vendor_type)) {
      return NextResponse.json({ error: "invalid vendor_type" }, { status: 400 });
    }

    const { data, error } = await ctx.serviceClient!.from("vendors").insert({
      organization_id: ctx.orgId,
      name: name.trim(),
      vendor_type,
      default_category_id: (default_category_id as string | null | undefined) ?? null,
      is_1099: Boolean(is_1099),
      tax_id: (tax_id as string | null | undefined) ?? null,
      notes: (notes as string | null | undefined) ?? null,
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  },
);
