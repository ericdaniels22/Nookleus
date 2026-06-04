"use client";

import Link from "next/link";
import type { Invoice } from "@/lib/types";
import { isOfficialInvoiceStatus } from "@/lib/invoice-status";

export type FinancialsInvoice = Pick<
  Invoice,
  "id" | "invoice_number" | "title" | "total_amount" | "status"
>;

function fmtCurrency(n: number): string {
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });
}

// Official invoices (sent/partial/paid) for the Job's Financials tab. Each row
// clicks through to the invoice's View — which keeps legacy/orphan invoices (no
// source estimate) reachable. Drafts/voided are filtered out via the shared
// official-invoice rule, so they never surface here.
export function FinancialsInvoiceList({ invoices }: { invoices: FinancialsInvoice[] }) {
  const official = invoices.filter((inv) => isOfficialInvoiceStatus(inv.status));
  if (official.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-neutral-200">Invoices</h3>
      <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
        {official.map((inv) => (
          <li key={inv.id}>
            <Link
              href={`/invoices/${inv.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/5"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-xs text-neutral-400">{inv.invoice_number}</span>
                <span className="truncate text-sm text-neutral-200">{inv.title}</span>
              </span>
              <span className="tabular-nums text-sm text-neutral-100">
                {fmtCurrency(inv.total_amount)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
