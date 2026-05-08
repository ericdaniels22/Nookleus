// Pure client-side calculation helpers — mirrors the server's recalculateTotals
// math from src/lib/estimates.ts (lines 148–166). No Supabase imports.
//
// These are used by the EstimateBuilder to update TotalsPanel live as the user
// edits markup / discount / tax fields, and when line-item qty/price changes.

import type { AdjustmentType } from "@/lib/types";
import { round2 } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// computeEstimateTotals
// ─────────────────────────────────────────────────────────────────────────────

export function computeEstimateTotals(input: {
  subtotal: number;
  markup_type: AdjustmentType;
  markup_value: number;
  discount_type: AdjustmentType;
  discount_value: number;
  tax_rate: number;
}): {
  markup_amount: number;
  discount_amount: number;
  adjusted_subtotal: number;
  tax_amount: number;
  total: number;
} {
  const { subtotal, markup_type, markup_value, discount_type, discount_value, tax_rate } = input;

  // Markup
  let markup_amount = 0;
  if (markup_type === "amount") markup_amount = round2(Number(markup_value));
  else if (markup_type === "percent") markup_amount = round2(subtotal * Number(markup_value) / 100);

  // Discount
  let discount_amount = 0;
  if (discount_type === "amount") discount_amount = round2(Number(discount_value));
  else if (discount_type === "percent") discount_amount = round2(subtotal * Number(discount_value) / 100);

  // Adjusted subtotal
  const adjusted_subtotal = round2(subtotal + markup_amount - discount_amount);

  // Tax
  const tax_amount = round2(adjusted_subtotal * Number(tax_rate) / 100);

  // Total
  const total = round2(adjusted_subtotal + tax_amount);

  return { markup_amount, discount_amount, adjusted_subtotal, tax_amount, total };
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

