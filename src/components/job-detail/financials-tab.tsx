"use client";

import type { Payment } from "@/lib/types";
import BillingSection from "@/components/billing/billing-section";
import ExpensesSection from "@/components/expenses/expenses-section";
import { FinancialsInvoiceList, type FinancialsInvoice } from "./financials-invoice-list";
import { profitFigure, type ProfitPalette } from "./profit-figure";

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
  const profit = profitFigure(summary);
  return (
    <div className="space-y-6">
      {/* Summary metrics row — 4 pills */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryPill label="Invoiced" value={fmtCurrency(summary.invoiced)} />
        <SummaryPill label="Collected" value={fmtCurrency(summary.collected)} />
        <SummaryPill label="Expenses" value={fmtCurrency(summary.expenses)} />
        <SummaryPill
          label={profit.label}
          value={fmtCurrency(summary.gross_margin)}
          palette={profit.palette}
          caption={profit.caption}
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
  palette,
  caption,
}: {
  label: string;
  value: string;
  /** when set, the pill is the highlighted figure tinted by sign (green/red) */
  palette?: ProfitPalette;
  caption?: string;
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={
        palette
          ? { background: palette.background, border: `1px solid ${palette.border}` }
          : {
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
            }
      }
    >
      <div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div>
      <div
        className="mt-1 text-2xl font-semibold"
        style={palette ? { color: palette.text } : undefined}
      >
        {value}
      </div>
      {caption && (
        <div
          className="mt-1 text-xs"
          style={{ color: palette ? palette.caption : "#a3a3a3" }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
