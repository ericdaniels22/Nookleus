import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission, requireAnyPermission } from "@/lib/permissions-api";
import { getItem, updateItem, deactivateItem } from "@/lib/item-library";
import { apiError } from "@/lib/api-errors";
import type { ItemCategory } from "@/lib/types";

interface RouteCtx { params: Promise<{ id: string }> }

const VALID_CATEGORIES: ItemCategory[] = [
  "labor", "equipment", "materials", "services", "other",
];

export async function GET(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requireAnyPermission(supabase, ["view_estimates", "view_invoices"]);
  if (!auth.ok) return auth.response;

  const item = await getItem(id, supabase);
  if (!item) return NextResponse.json({ error: "item not found" }, { status: 404 });

  return NextResponse.json({ item });
}

interface UpdatePayload {
  name?: string;
  description?: string;
  code?: string | null;
  category?: ItemCategory;
  default_quantity?: number;
  default_unit?: string | null;
  unit_price?: number;
  damage_type_tags?: string[];
  section_tags?: string[];
  is_active?: boolean;
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_item_library");
  if (!auth.ok) return auth.response;

  let body: UpdatePayload;
  try {
    body = (await request.json()) as UpdatePayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Verify the row exists for a clean 404
  const existing = await getItem(id, supabase);
  if (!existing) return NextResponse.json({ error: "item not found" }, { status: 404 });

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    if (body.name.length > 200) {
      return NextResponse.json({ error: "name too long" }, { status: 400 });
    }
    update.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      return NextResponse.json({ error: "description must be a string" }, { status: 400 });
    }
    if (body.description.length > 2000) {
      return NextResponse.json({ error: "description too long" }, { status: 400 });
    }
    update.description = body.description;
  }
  if (body.code !== undefined) {
    if (body.code !== null && typeof body.code !== "string") {
      return NextResponse.json({ error: "code must be a string or null" }, { status: 400 });
    }
    update.code = body.code;
  }
  if (body.default_unit !== undefined) {
    if (body.default_unit !== null && typeof body.default_unit !== "string") {
      return NextResponse.json({ error: "default_unit must be a string or null" }, { status: 400 });
    }
    update.default_unit = body.default_unit;
  }
  if (body.category !== undefined) {
    if (!VALID_CATEGORIES.includes(body.category)) {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }
    update.category = body.category;
  }
  if (body.default_quantity !== undefined) {
    if (typeof body.default_quantity !== "number" || !Number.isFinite(body.default_quantity)) {
      return NextResponse.json({ error: "default_quantity must be a number" }, { status: 400 });
    }
    update.default_quantity = body.default_quantity;
  }
  if (body.unit_price !== undefined) {
    if (typeof body.unit_price !== "number" || !Number.isFinite(body.unit_price)) {
      return NextResponse.json({ error: "unit_price must be a number" }, { status: 400 });
    }
    update.unit_price = body.unit_price;
  }
  if (body.damage_type_tags !== undefined) {
    if (!Array.isArray(body.damage_type_tags)) {
      return NextResponse.json({ error: "damage_type_tags must be an array" }, { status: 400 });
    }
    update.damage_type_tags = body.damage_type_tags;
  }
  if (body.section_tags !== undefined) {
    if (!Array.isArray(body.section_tags)) {
      return NextResponse.json({ error: "section_tags must be an array" }, { status: 400 });
    }
    update.section_tags = body.section_tags;
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json({ error: "is_active must be boolean" }, { status: 400 });
    }
    update.is_active = body.is_active;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no updatable fields supplied" }, { status: 400 });
  }

  try {
    const item = await updateItem(id, update as Parameters<typeof updateItem>[1], supabase);
    return NextResponse.json({ item });
  } catch (e) {
    return apiError(e, "PUT /api/item-library/[id] update");
  }
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_item_library");
  if (!auth.ok) return auth.response;

  const existing = await getItem(id, supabase);
  if (!existing) return NextResponse.json({ error: "item not found" }, { status: 404 });

  if (!existing.is_active) {
    // Idempotent — already deactivated.
    return NextResponse.json({ ok: true, item: existing });
  }

  try {
    await deactivateItem(id, supabase);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, "DELETE /api/item-library/[id] deactivate");
  }
}
