// The pricing waterfall — the single source of the estimate/invoice money
// math (#566): subtotal → +markup → −discount → adjusted subtotal → +tax →
// total. Pure, no Supabase imports, so both the server recalc paths
// (estimates.ts / invoices.ts) and the client builder's live totals share it.
//
// Money contracts:
// - discount is computed from the RAW subtotal, not the marked-up one
// - tax is adjusted_subtotal × taxRatePercent / 100 — taxRatePercent is a
//   whole-number percent (8.25 = 8.25%) matching the tax_rate numeric(6,4)
//   column, NOT a fraction
// - each leg is rounded to cents independently
//
// The PL/pgSQL convert-to-invoice copy still duplicates this math; it gets
// folded in when Overhead & Profit lands (#564).

import type { AdjustmentType } from "@/lib/types";
import { round2 } from "@/lib/format";

export interface Adjustment {
  type: AdjustmentType;
  value: number;
}

export type WaterfallInput = {
  markup: Adjustment;
  discount: Adjustment;
  /** Whole-number percent, e.g. 8.25 = 8.25%. */
  taxRatePercent: number;
} & (
  | { lineItemCharges: number[] }
  | { subtotal: number } // precomputed, e.g. the builder's summed sections
);

export interface WaterfallResult {
  subtotal: number;
  markup_amount: number;
  discount_amount: number;
  adjusted_subtotal: number;
  tax_amount: number;
  total: number;
}

export function computeWaterfall(input: WaterfallInput): WaterfallResult {
  const subtotal = round2(
    "subtotal" in input
      ? Number(input.subtotal)
      : input.lineItemCharges.reduce((a, b) => a + Number(b), 0),
  );

  const markup_amount = adjustmentAmount(input.markup, subtotal);
  const discount_amount = adjustmentAmount(input.discount, subtotal); // raw subtotal, not marked-up
  const adjusted_subtotal = round2(subtotal + markup_amount - discount_amount);

  const tax_amount = round2((adjusted_subtotal * Number(input.taxRatePercent)) / 100);
  const total = round2(adjusted_subtotal + tax_amount);

  return { subtotal, markup_amount, discount_amount, adjusted_subtotal, tax_amount, total };
}

function adjustmentAmount(adjustment: Adjustment, subtotal: number): number {
  if (adjustment.type === "percent") return round2((subtotal * Number(adjustment.value)) / 100);
  if (adjustment.type === "amount") return round2(Number(adjustment.value));
  return 0;
}
