// Pure client-side calculation helpers. No Supabase imports.
//
// These are used by the EstimateBuilder to update the totals bar live as the user
// edits markup / discount / tax fields, and when line-item qty/price changes.

import type { AdjustmentType } from "@/lib/types";
import { round2 } from "@/lib/format";
import { computeWaterfall } from "@/lib/waterfall";

// ─────────────────────────────────────────────────────────────────────────────
// computeEstimateTotals — maps an estimate/invoice row's flat adjustment
// fields onto the shared pricing waterfall, so the builder's live totals are
// computed by the exact same function as the server-persisted ones.
// ─────────────────────────────────────────────────────────────────────────────

export function computeEstimateTotals(input: {
  subtotal: number;
  overhead_type: AdjustmentType;
  overhead_value: number;
  profit_type: AdjustmentType;
  profit_value: number;
  discount_type: AdjustmentType;
  discount_value: number;
  tax_rate: number;
}): {
  overhead_amount: number;
  profit_amount: number;
  markup_amount: number;
  discount_amount: number;
  adjusted_subtotal: number;
  tax_amount: number;
  total: number;
} {
  const t = computeWaterfall({
    subtotal: input.subtotal,
    overhead: { type: input.overhead_type, value: Number(input.overhead_value) },
    profit: { type: input.profit_type, value: Number(input.profit_value) },
    discount: { type: input.discount_type, value: Number(input.discount_value) },
    taxRatePercent: Number(input.tax_rate),
  });
  // Callers spread this into row state — keep the historical shape (no subtotal).
  // Invoices read only markup_amount (their single-markup leg); estimates read
  // overhead_amount/profit_amount too.
  return {
    overhead_amount: t.overhead_amount,
    profit_amount: t.profit_amount,
    markup_amount: t.markup_amount,
    discount_amount: t.discount_amount,
    adjusted_subtotal: t.adjusted_subtotal,
    tax_amount: t.tax_amount,
    total: t.total,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// sumLineItemsFromSections
// ─────────────────────────────────────────────────────────────────────────────

type SectionLike = {
  items: Array<{ quantity: number; unit_price: number }>;
  subsections: Array<{
    items: Array<{ quantity: number; unit_price: number }>;
  }>;
};

export function sumLineItemsFromSections(sections: SectionLike[]): number {
  let total = 0;
  for (const sec of sections) {
    for (const item of sec.items) total += Number(item.quantity) * Number(item.unit_price);
    for (const sub of sec.subsections) {
      for (const item of sub.items) total += Number(item.quantity) * Number(item.unit_price);
    }
  }
  return round2(total);
}

