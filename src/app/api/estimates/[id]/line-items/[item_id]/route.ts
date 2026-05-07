import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { checkSnapshot, recalculateTotals } from "@/lib/estimates";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { round2 } from "@/lib/format";
import type { EstimateLineItem } from "@/lib/types";

interface RouteCtx { params: Promise<{ id: string; item_id: string }> }

interface UpdatePayload {
  name?: string | null;
  description?: string;
  code?: string | null;
  quantity?: number;
  unit?: string | null;
  unit_price?: number;
  section_id?: string;
  sort_order?: number;
  updated_at_snapshot?: string;
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const { id: estimateId, item_id: itemId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const { data: estimateRow } = await supabase
    .from("estimates")
    .select("deleted_at")
    .eq("id", estimateId)
    .maybeSingle<{ deleted_at: string | null }>();
  const trashed = assertNotTrashed(estimateRow);
  if (trashed) return trashed;

  let body: UpdatePayload;
  try {
    body = (await request.json()) as UpdatePayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const snap = await checkSnapshot(supabase, estimateId, body.updated_at_snapshot);
  if (!snap.ok) return snap.response;

  // Existing row — needed for recompute of total when only one of qty
  // or unit_price changes
  const { data: existing } = await supabase
    .from("estimate_line_items")
    .select("id, section_id, quantity, unit_price")
    .eq("id", itemId)
    .eq("estimate_id", estimateId)
    .maybeSingle<{ id: string; section_id: string; quantity: number; unit_price: number }>();
  if (!existing) {
    return NextResponse.json({ error: "line item not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (body.name === null) {
      update.name = null;
    } else if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name must be a string or null" }, { status: 400 });
    } else {
      const trimmed = body.name.trim();
      if (trimmed.length > 200) {
        return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
      }
      update.name = trimmed.length > 0 ? trimmed : null;
    }
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string" || !body.description.trim()) {
      return NextResponse.json({ error: "description cannot be empty" }, { status: 400 });
    }
    if (body.description.length > 2000) {
      return NextResponse.json({ error: "description too long (max 2000)" }, { status: 400 });
    }
    update.description = body.description.trim();
  }
  if (body.code !== undefined) update.code = body.code;
  if (body.unit !== undefined) update.unit = body.unit;
  if (body.section_id !== undefined) {
    if (typeof body.section_id !== "string") {
      return NextResponse.json({ error: "section_id must be a string" }, { status: 400 });
    }
    // Verify target section belongs to same estimate
    const { data: tgt } = await supabase
      .from("estimate_sections")
      .select("id")
      .eq("id", body.section_id)
      .eq("estimate_id", estimateId)
      .maybeSingle<{ id: string }>();
    if (!tgt) {
      return NextResponse.json({ error: "target section not found" }, { status: 404 });
    }
    update.section_id = body.section_id;
  }
  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== "number") {
      return NextResponse.json({ error: "sort_order must be a number" }, { status: 400 });
    }
    update.sort_order = body.sort_order;
  }

  let qtyChanged = false;
  let priceChanged = false;
  if (body.quantity !== undefined) {
    if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity)) {
      return NextResponse.json({ error: "quantity must be a number" }, { status: 400 });
    }
    update.quantity = body.quantity;
    qtyChanged = true;
  }
  if (body.unit_price !== undefined) {
    if (typeof body.unit_price !== "number" || !Number.isFinite(body.unit_price)) {
      return NextResponse.json({ error: "unit_price must be a number" }, { status: 400 });
    }
    update.unit_price = body.unit_price;
    priceChanged = true;
  }
  if (qtyChanged || priceChanged) {
    const newQty = qtyChanged ? (body.quantity as number) : existing.quantity;
    const newPrice = priceChanged ? (body.unit_price as number) : existing.unit_price;
    update.total = round2(newQty * newPrice);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no updatable fields supplied" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("estimate_line_items")
    .update(update)
    .eq("id", itemId)
    .eq("estimate_id", estimateId)
    .select("*")
    .single<EstimateLineItem>();
  if (error) return apiDbError(error.message, "PUT /api/estimates/[id]/line-items/[item_id] update");

  await recalculateTotals(estimateId, supabase);

  // Read the parent's new updated_at so the client can refresh its snapshot.
  const { data: parent } = await supabase
    .from("estimates")
    .select("updated_at")
    .eq("id", estimateId)
    .maybeSingle<{ updated_at: string }>();

  return NextResponse.json({ line_item: data, updated_at: parent?.updated_at ?? null });
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const { id: estimateId, item_id: itemId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const { data: estimateRowDel } = await supabase
    .from("estimates")
    .select("deleted_at")
    .eq("id", estimateId)
    .maybeSingle<{ deleted_at: string | null }>();
  const trashedDel = assertNotTrashed(estimateRowDel);
  if (trashedDel) return trashedDel;

  const { data: existing } = await supabase
    .from("estimate_line_items")
    .select("id")
    .eq("id", itemId)
    .eq("estimate_id", estimateId)
    .maybeSingle<{ id: string }>();
  if (!existing) {
    return NextResponse.json({ error: "line item not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("estimate_line_items")
    .delete()
    .eq("id", itemId)
    .eq("estimate_id", estimateId);
  if (error) return apiDbError(error.message, "DELETE /api/estimates/[id]/line-items/[item_id]");

  await recalculateTotals(estimateId, supabase);

  return NextResponse.json({ ok: true });
}
