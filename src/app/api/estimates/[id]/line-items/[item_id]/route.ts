import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { checkSnapshot, recalculateTotals } from "@/lib/estimates";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { round2 } from "@/lib/format";
import type { EstimateLineItem, PricingMode } from "@/lib/types";
import {
  EQUIPMENT_MODE,
  deriveEquipmentNote,
} from "@/components/estimate-builder/equipment-pricing";

interface RouteCtx { params: Promise<{ id: string; item_id: string }> }

interface UpdatePayload {
  name?: string | null;
  description?: string;
  note?: string | null;
  code?: string | null;
  quantity?: number;
  unit?: string | null;
  unit_price?: number;
  section_id?: string;
  sort_order?: number;
  // Equipment pricing (#682). When the row is in equipment mode the server
  // derives quantity/note/total from pieces × days; see below.
  pricing_mode?: PricingMode;
  pieces?: number | null;
  days?: number | null;
  updated_at_snapshot?: string;
}

export const PUT = withRequestContext(
  { permission: "edit_estimates" },
  async (request, { supabase }, ctx: RouteCtx) => {
    const { id: estimateId, item_id: itemId } = await ctx.params;

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
      .select("id, section_id, quantity, unit_price, pricing_mode, pieces, days")
      .eq("id", itemId)
      .eq("estimate_id", estimateId)
      .maybeSingle<{
        id: string;
        section_id: string;
        quantity: number;
        unit_price: number;
        pricing_mode: PricingMode | null;
        pieces: number | null;
        days: number | null;
      }>();
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
    if (body.note !== undefined) {
      if (body.note === null) {
        update.note = null;
      } else if (typeof body.note !== "string") {
        return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
      } else {
        const trimmed = body.note.trim();
        if (trimmed.length > 2000) {
          return NextResponse.json({ error: "note too long (max 2000)" }, { status: 400 });
        }
        update.note = trimmed.length > 0 ? trimmed : null;
      }
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

    // Equipment pricing (#682) — validate and persist the mode + raw inputs.
    if (body.pricing_mode !== undefined) {
      if (body.pricing_mode !== "standard" && body.pricing_mode !== "pieces_days") {
        return NextResponse.json(
          { error: "pricing_mode must be 'standard' or 'pieces_days'" },
          { status: 400 },
        );
      }
      update.pricing_mode = body.pricing_mode;
    }
    // pieces/days must be positive when present — a "0 units" or negative-quantity
    // rental is never valid, and the reconcilers/seed all guard `> 0 ? x : 1`.
    if (body.pieces !== undefined) {
      if (
        body.pieces !== null &&
        (typeof body.pieces !== "number" || !Number.isFinite(body.pieces) || body.pieces <= 0)
      ) {
        return NextResponse.json({ error: "pieces must be a positive number or null" }, { status: 400 });
      }
      update.pieces = body.pieces;
    }
    if (body.days !== undefined) {
      if (
        body.days !== null &&
        (typeof body.days !== "number" || !Number.isFinite(body.days) || body.days <= 0)
      ) {
        return NextResponse.json({ error: "days must be a positive number or null" }, { status: 400 });
      }
      update.days = body.days;
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

    // For an equipment row, the server owns the collapsed quantity, the derived
    // note, and the total — `quantity = pieces × days`, so they can't drift from
    // a stale or buggy client. This overrides whatever the client sent for
    // those fields. Standard rows keep the per-field logic above.
    const effectiveMode = body.pricing_mode ?? existing.pricing_mode ?? "standard";
    if (effectiveMode === EQUIPMENT_MODE) {
      const pieces = (body.pieces !== undefined ? body.pieces : existing.pieces) ?? 1;
      const days = (body.days !== undefined ? body.days : existing.days) ?? 1;
      const unitPrice = priceChanged ? (body.unit_price as number) : existing.unit_price;
      update.quantity = pieces * days;
      update.note = deriveEquipmentNote(pieces, days);
      update.total = round2(pieces * days * unitPrice);
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
  },
);

export const DELETE = withRequestContext(
  { permission: "edit_estimates" },
  async (_request, { supabase }, ctx: RouteCtx) => {
    const { id: estimateId, item_id: itemId } = await ctx.params;

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
  },
);
