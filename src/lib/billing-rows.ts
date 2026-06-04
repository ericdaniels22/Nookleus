// src/lib/billing-rows.ts — the billing-row builder (#384).
//
// A pure transform: given a Job's estimates and their linked invoices, produce
// the ordered Overview rows. Each row carries its derived state — plain estimate
// vs flipped-to-invoice, the status to show, the row tint, which document
// view/edit targets, whether it may still be edited, and the link to the frozen
// original estimate. Encapsulates the "flip" and handles the edge cases:
// converted, voided, and legacy invoices with no source estimate.
//
// Generic over the estimate/invoice shapes — it only reads the few fields below,
// so the full Estimate / Invoice row types are accepted and carried through
// untouched for the UI to render. See ADR 0007.

import { rowTint, type RowTint, type EntityKind } from "@/lib/estimate-status";

/** The estimate fields the builder reads. */
export interface BillingEstimateFields {
  id: string;
  status: string;
  sequence_number: number;
  converted_to_invoice_id: string | null;
}

/** The invoice fields the builder reads. */
export interface BillingInvoiceFields {
  id: string;
  status: string;
  sequence_number: number;
  converted_from_estimate_id: string | null;
}

export interface BillingRow<
  E extends BillingEstimateFields = BillingEstimateFields,
  I extends BillingInvoiceFields = BillingInvoiceFields,
> {
  /** Stable React key — the estimate's id for estimate-anchored rows. */
  id: string;
  /** Plain estimate vs flipped-to-invoice. */
  kind: EntityKind;
  /** The status to display: the estimate's, or the invoice's once flipped. */
  statusShown: string;
  /** Row tint derived from (kind, statusShown). */
  tint: RowTint;
  /** Which document the row's View / Edit target. */
  document: { kind: EntityKind; id: string };
  /** Whether the row's document may still be edited. */
  canEdit: boolean;
  /** The frozen original estimate to link to from a flipped row; null otherwise. */
  frozenEstimateId: string | null;
  /** The underlying records, carried through for rendering. */
  estimate: E | null;
  invoice: I | null;
}

export function buildBillingRows<
  E extends BillingEstimateFields,
  I extends BillingInvoiceFields,
>(estimates: E[], invoices: I[]): BillingRow<E, I>[] {
  const claimed = new Set<string>();
  const bySequence = (a: { sequence_number: number }, b: { sequence_number: number }) =>
    a.sequence_number - b.sequence_number;

  // Each estimate anchors one row: a plain estimate, or — once converted — a
  // row that flips to represent its linked invoice. Ordered by estimate sequence.
  const estimateRows = [...estimates].sort(bySequence).map((estimate) => {
    const invoice = estimate.converted_to_invoice_id
      ? invoices.find((i) => i.id === estimate.converted_to_invoice_id) ?? null
      : null;

    if (invoice) {
      claimed.add(invoice.id);
      return invoiceRow(invoice, estimate);
    }

    return {
      id: estimate.id,
      kind: "estimate",
      statusShown: estimate.status,
      tint: rowTint("estimate", estimate.status),
      document: { kind: "estimate", id: estimate.id },
      canEdit: estimate.status !== "voided" && estimate.status !== "converted",
      frozenEstimateId: null,
      estimate,
      invoice: null,
    } satisfies BillingRow<E, I>;
  });

  // Legacy orphan invoices — never born from an estimate on this job — stay
  // reachable as their own rows, with no frozen estimate behind them. Ordered
  // after the estimates, by invoice sequence.
  const orphanRows = invoices
    .filter((invoice) => !claimed.has(invoice.id))
    .sort(bySequence)
    .map((invoice) => invoiceRow<E, I>(invoice, null));

  return [...estimateRows, ...orphanRows];
}

// A row that represents an invoice — either a converted estimate's flipped row
// (with the frozen original behind it) or a legacy orphan (estimate = null).
function invoiceRow<
  E extends BillingEstimateFields,
  I extends BillingInvoiceFields,
>(invoice: I, estimate: E | null): BillingRow<E, I> {
  return {
    id: (estimate ?? invoice).id,
    kind: "invoice",
    statusShown: invoice.status,
    tint: rowTint("invoice", invoice.status),
    document: { kind: "invoice", id: invoice.id },
    canEdit: invoice.status !== "paid" && invoice.status !== "voided",
    frozenEstimateId: estimate ? estimate.id : null,
    estimate,
    invoice,
  };
}
