// src/lib/invoice-status.ts
// Single source of truth for which invoice statuses are "official" — i.e. count
// as a real bill. sent / partial / paid are official; draft / voided are not.
//
// Everything that cares about "is this a real bill" consults this rule instead
// of hard-coding status lists: the Job Financials tab, the Job "Invoiced" total,
// the org-wide profitability roll-up, and (mirrored in SQL) the QuickBooks gate.
//
// Pure, zero-runtime-dependency leaf — same pattern as margin-bands.ts — so both
// client components and server modules can import it without dragging in the
// server-only Supabase bundle.

import type { Invoice } from "@/lib/types";

export type InvoiceStatus = Invoice["status"];

/** The invoice statuses that count as a real bill, in lifecycle order. */
export const OFFICIAL_INVOICE_STATUSES = [
  "sent",
  "partial",
  "paid",
] as const satisfies readonly InvoiceStatus[];

/** True when an invoice's status makes it official (a real bill). */
export function isOfficialInvoiceStatus(status: InvoiceStatus | string): boolean {
  return (OFFICIAL_INVOICE_STATUSES as readonly string[]).includes(status);
}
