"use client";

import type { Payment } from "@/lib/types";
import BillingSection from "@/components/billing/billing-section";
import ExpensesSection from "@/components/expenses/expenses-section";
import { FinancialsInvoiceList, type FinancialsInvoice } from "./financials-invoice-list";

type Props = {
  jobId: string;
  payments: Payment[];
  invoices: FinancialsInvoice[];
  summary: {
    invoiced: number;
    collected: number;
    expenses: number;
    gross_margin: number;
    margin_pct: number | null;
    in_progress: boolean;
  };
  onPaymentRecorded: () => void;
  onExpenseLogged: () => void;
  stripeConnected?: boolean;
};

function fmtCurrency(n: number): string {
  // Show cents when the value has a non-zero fractional part (so small test
  // invoices don't collapse to $0); otherwise keep the clean integer display.
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });
}

export default function FinancialsTab({
  jobId,
  payments,
  invoices,
  summary,
  onPaymentRecorded,
  onExpenseLogged,
  stripeConnected = false,
}: Props) {
  return (
    <div className="space-y-6">
      {/* Summary metrics row — 4 pills */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryPill label="Invoiced" value={fmtCurrency(summary.invoiced)} />
        <SummaryPill label="Collected" value={fmtCurrency(summary.collected)} />
        <SummaryPill label="Expenses" value={fmtCurrency(summary.expenses)} />
        <SummaryPill
          label="Gross margin"
          value={fmtCurrency(summary.gross_margin)}
          highlight
          caption={
            summary.in_progress
              ? "(in progress)"
              : summary.margin_pct !== null
              ? `${summary.margin_pct.toFixed(1)}% margin`
              : undefined
          }
        />
      </div>

      <FinancialsInvoiceList invoices={invoices} />

      <BillingSection
        jobId={jobId}
        payments={payments}
        onPaymentRecorded={onPaymentRecorded}
        stripeConnected={stripeConnected}
      />

      <ExpensesSection jobId={jobId} onChanged={onExpenseLogged} />
    </div>
  );
}

function SummaryPill({
  label,
  value,
  highlight,
  caption,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  caption?: string;
}) {
  const hl = highlight
    ? {
        background: "rgba(29, 158, 117, 0.12)",
        border: "1px solid rgba(29, 158, 117, 0.35)",
        color: "#5DCAA5",
      }
    : undefined;
  return (
    <div
      className="rounded-lg p-4"
      style={
        hl ?? {
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
        }
      }
    >
      <div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div>
      <div
        className="mt-1 text-2xl font-semibold"
        style={hl ? { color: "#5DCAA5" } : undefined}
      >
        {value}
      </div>
      {caption && (
        <div
          className="mt-1 text-xs"
          style={{ color: highlight ? "#9FE1CB" : "#a3a3a3" }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
