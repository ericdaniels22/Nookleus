// The pricing waterfall — the single source of the estimate/invoice money
// math (#566): subtotal → +overhead → +profit → −discount → adjusted subtotal
// → +tax → total. Pure, no Supabase imports, so both the server recalc paths
// (estimates.ts / invoices.ts) and the client builder's live totals share it.
//
// #572 split the single Markup into two independent uplifts — Overhead and
// Profit ("10 & 10") — each applied to the RAW subtotal. markup_amount is kept
// as their sum (overhead_amount + profit_amount) so every existing reader of
// markup_amount keeps working. Estimates carry both legs since #572, invoices
// since #575; the legacy markup_type/markup_value columns are write-dead on
// both.
//
// Money contracts:
// - overhead, profit, and discount are each computed from the RAW subtotal,
//   not the marked-up one
// - tax is adjusted_subtotal × taxRatePercent / 100 — taxRatePercent is a
//   whole-number percent (8.25 = 8.25%) matching the tax_rate columns
//   (numeric(5,2) on estimates, numeric(6,4) on invoices), NOT a fraction
// - each leg is rounded to cents independently, THEN summed — so overhead 10%
//   + profit 10% can land a cent off a single 20% markup; that penny is
//   intended (see waterfall.test.ts)
//
// Two PL/pgSQL copies of this math are still live: convert_estimate_to_invoice
// (Overhead & Profit since migration-build82b, #575) and
// apply_template_to_estimate. Their formulas match but their rounding doesn't —
// Postgres round(numeric,2) is exact half-away-from-zero while round2 is float
// Math.round, so a leg landing on an exact half cent can differ by a penny
// (e.g. $2.90 at 5% markup → 0.15 SQL vs 0.14 here).

import type { AdjustmentType } from "@/lib/types";
import { round2 } from "@/lib/format";

export interface Adjustment {
  type: AdjustmentType;
  value: number;
}

export type WaterfallInput = {
  /** First markup leg. */
  overhead: Adjustment;
  /** Second markup leg. */
  profit: Adjustment;
  discount: Adjustment;
  /** Whole-number percent, e.g. 8.25 = 8.25%. */
  taxRatePercent: number;
} & (
  // The `?: never` members keep the two forms mutually exclusive — without
  // them an object carrying BOTH keys would typecheck and `subtotal` would
  // silently win (the implementation checks "subtotal" in input first).
  | { lineItemCharges: number[]; subtotal?: never }
  // Precomputed (e.g. the builder's summed sections); re-rounded to cents
  // before the legs are computed.
  | { subtotal: number; lineItemCharges?: never }
);

export interface WaterfallResult {
  subtotal: number;
  overhead_amount: number;
  profit_amount: number;
  /** overhead_amount + profit_amount — the combined Markup, kept for readers. */
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

  // Each leg is computed off the RAW subtotal and rounded to cents on its own.
  const overhead_amount = adjustmentAmount(input.overhead, subtotal);
  const profit_amount = adjustmentAmount(input.profit, subtotal);
  // Sum the already-rounded legs (round2 guards the float add). This is what
  // lets overhead 10% + profit 10% differ by a cent from a single 20% markup.
  const markup_amount = round2(overhead_amount + profit_amount);
  const discount_amount = adjustmentAmount(input.discount, subtotal); // raw subtotal, not marked-up
  const adjusted_subtotal = round2(subtotal + markup_amount - discount_amount);

  const tax_amount = round2((adjusted_subtotal * Number(input.taxRatePercent)) / 100);
  const total = round2(adjusted_subtotal + tax_amount);

  return {
    subtotal,
    overhead_amount,
    profit_amount,
    markup_amount,
    discount_amount,
    adjusted_subtotal,
    tax_amount,
    total,
  };
}

function adjustmentAmount(adjustment: Adjustment, subtotal: number): number {
  if (adjustment.type === "percent") return round2((subtotal * Number(adjustment.value)) / 100);
  if (adjustment.type === "amount") return round2(Number(adjustment.value));
  return 0;
}
