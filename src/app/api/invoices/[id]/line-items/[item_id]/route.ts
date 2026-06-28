import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { checkSnapshot, touchEntity, roundMoney } from "@/lib/builder-shared";
import { recalculateInvoiceTotals } from "@/lib/invoices";
import type { PricingMode } from "@/lib/types";
import {
  EQUIPMENT_MODE,
  deriveEquipmentNote,
} from "@/components/estimate-builder/equipment-pricing";

interface PutBody {
  name?: string | null;
  description?: string;
  note?: string | null;
  code?: string | null;
  quantity?: number;
  unit?: string | null;
  unit_price?: number;
  section_id?: string;
  sort_order?: number;
  // Equipment pricing (#684) — mirrors the Estimate route. When the row is in
  // equipment mode the server derives quantity/note/amount from pieces × days;
  // see the recompute block below.
  pricing_mode?: PricingMode;
  pieces?: number | null;
  days?: number | null;
  updated_at_snapshot?: string;
}

export const PUT = withRequestContext(
  { permission: "edit_invoices" },
  async (request, { supabase }, { params }: { params: Promise<{ id: string; item_id: string }> }) => {
    const { id, item_id } = await params;

    const { data: invoiceRow } = await supabase
      .from("invoices")
      .select("deleted_at")
      .eq("id", id)
      .maybeSingle<{ deleted_at: string | null }>();
    const trashed = assertNotTrashed(invoiceRow);
    if (trashed) return trashed;

    const body = (await request.json().catch(() => null)) as PutBody | null;
    if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

    try {
      const { stale, current } = await checkSnapshot(supabase, "invoices", id, body.updated_at_snapshot);
      if (stale) {
        return NextResponse.json(
          { error: "stale_snapshot", current_updated_at: current },
          { status: current === null ? 404 : 409 },
        );
      }

      // If section_id changed, validate it belongs to this invoice
      if (body.section_id) {
        const { data: sec } = await supabase
          .from("invoice_sections").select("id").eq("id", body.section_id).eq("invoice_id", id).maybeSingle<{ id: string }>();
        if (!sec) return NextResponse.json({ error: "section_not_in_invoice" }, { status: 400 });
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.name !== undefined) {
        if (body.name === null) {
          patch.name = null;
        } else if (typeof body.name !== "string") {
          return NextResponse.json({ error: "name must be a string or null" }, { status: 400 });
        } else {
          const trimmed = body.name.trim();
          if (trimmed.length > 200) {
            return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
          }
          patch.name = trimmed.length > 0 ? trimmed : null;
        }
      }
      if (body.description !== undefined) patch.description = body.description;
      if (body.note !== undefined) {
        if (body.note === null) {
          patch.note = null;
        } else if (typeof body.note !== "string") {
          return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
        } else {
          const trimmed = body.note.trim();
          if (trimmed.length > 2000) {
            return NextResponse.json({ error: "note too long (max 2000)" }, { status: 400 });
          }
          patch.note = trimmed.length > 0 ? trimmed : null;
        }
      }
      if (body.code !== undefined) patch.code = body.code;
      if (body.quantity !== undefined) {
        const q = Number(body.quantity);
        if (!Number.isFinite(q)) return NextResponse.json({ error: "quantity must be finite" }, { status: 400 });
        patch.quantity = q;
      }
      if (body.unit !== undefined) patch.unit = body.unit;
      if (body.unit_price !== undefined) {
        const p = Number(body.unit_price);
        if (!Number.isFinite(p)) return NextResponse.json({ error: "unit_price must be finite" }, { status: 400 });
        patch.unit_price = p;
      }
      if (body.section_id !== undefined) patch.section_id = body.section_id;
      if (body.sort_order !== undefined) patch.sort_order = body.sort_order;

      // Equipment pricing (#684) — validate the mode + raw inputs, mirroring the
      // Estimate route so the shared editor behaves identically on an Invoice.
      if (body.pricing_mode !== undefined) {
        if (body.pricing_mode !== "standard" && body.pricing_mode !== "pieces_days") {
          return NextResponse.json({ error: "pricing_mode must be 'standard' or 'pieces_days'" }, { status: 400 });
        }
        patch.pricing_mode = body.pricing_mode;
      }
      if (body.pieces !== undefined) {
        if (body.pieces !== null && (typeof body.pieces !== "number" || !Number.isFinite(body.pieces) || body.pieces <= 0)) {
          return NextResponse.json({ error: "pieces must be a positive number or null" }, { status: 400 });
        }
        patch.pieces = body.pieces;
      }
      if (body.days !== undefined) {
        if (body.days !== null && (typeof body.days !== "number" || !Number.isFinite(body.days) || body.days <= 0)) {
          return NextResponse.json({ error: "days must be a positive number or null" }, { status: 400 });
        }
        patch.days = body.days;
      }

      // Read the existing row once: needed both for the standard amount recompute
      // and to carry over pieces/days/unit_price when the client only touches one
      // of them on an equipment row.
      const needsExisting =
        body.quantity !== undefined ||
        body.unit_price !== undefined ||
        body.pricing_mode !== undefined ||
        body.pieces !== undefined ||
        body.days !== undefined;
      if (needsExisting) {
        const { data: cur } = await supabase
          .from("invoice_line_items")
          .select("quantity, unit_price, pricing_mode, pieces, days")
          .eq("id", item_id)
          .maybeSingle<{
            quantity: number;
            unit_price: number;
            pricing_mode: PricingMode | null;
            pieces: number | null;
            days: number | null;
          }>();

        // Standard amount recompute when qty/price touched.
        if (body.quantity !== undefined || body.unit_price !== undefined) {
          const qty = body.quantity !== undefined ? Number(body.quantity) : Number(cur?.quantity);
          const price = body.unit_price !== undefined ? Number(body.unit_price) : Number(cur?.unit_price);
          patch.amount = roundMoney(qty * price);
        }

        // On an equipment row the server owns the collapsed quantity, the derived
        // note, and the amount (quantity = pieces × days) so they can't drift from
        // a stale or buggy client — overriding whatever it sent for those fields.
        const effectiveMode = body.pricing_mode ?? cur?.pricing_mode ?? "standard";
        if (effectiveMode === EQUIPMENT_MODE) {
          const pieces = (body.pieces !== undefined ? body.pieces : cur?.pieces) ?? 1;
          const days = (body.days !== undefined ? body.days : cur?.days) ?? 1;
          const unitPrice = body.unit_price !== undefined ? Number(body.unit_price) : Number(cur?.unit_price);
          patch.quantity = pieces * days;
          patch.note = deriveEquipmentNote(pieces, days);
          patch.amount = roundMoney(pieces * days * unitPrice);
        }
      }

      const { error } = await supabase.from("invoice_line_items").update(patch).eq("id", item_id).eq("invoice_id", id);
      if (error) throw error;

      await recalculateInvoiceTotals(supabase, id);
      const { data: invNow } = await supabase.from("invoices").select("updated_at").eq("id", id).maybeSingle<{ updated_at: string }>();
      return NextResponse.json({ ok: true, updated_at: invNow?.updated_at });
    } catch (e: unknown) {
      return apiDbError(e instanceof Error ? e.message : String(e), "PUT /api/invoices/[id]/line-items/[item_id]");
    }
  },
);

export const DELETE = withRequestContext(
  { permission: "edit_invoices" },
  async (_request, { supabase }, { params }: { params: Promise<{ id: string; item_id: string }> }) => {
    const { id, item_id } = await params;

    const { data: invoiceRowDel } = await supabase
      .from("invoices")
      .select("deleted_at")
      .eq("id", id)
      .maybeSingle<{ deleted_at: string | null }>();
    const trashedDel = assertNotTrashed(invoiceRowDel);
    if (trashedDel) return trashedDel;

    try {
      const { error } = await supabase.from("invoice_line_items").delete().eq("id", item_id).eq("invoice_id", id);
      if (error) throw error;
      await recalculateInvoiceTotals(supabase, id);
      await touchEntity(supabase, "invoices", id);
      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      return apiDbError(e instanceof Error ? e.message : String(e), "DELETE /api/invoices/[id]/line-items/[item_id]");
    }
  },
);
