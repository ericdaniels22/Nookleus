"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RangePreset } from "@/lib/accounting/date-ranges";
import ReceiptDetailModal from "@/components/expenses/receipt-detail-modal";
import { soften } from "@/lib/badge-colors";
import type { Expense } from "@/lib/types";

type Row = {
  id: string;
  job_id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  category_id: string;
  amount: number;
  expense_date: string;
  payment_method: string | null;
  description: string | null;
  receipt_path: string | null;
  thumbnail_path: string | null;
  submitted_by: string | null;
  submitter_name: string | null;
  created_at: string;
  expense_categories: {
    name: string;
    display_label: string;
    bg_color: string;
    text_color: string;
  } | null;
  jobs: {
    id: string;
    job_number: string | null;
    property_address: string | null;
    damage_type: string | null;
  } | null;
};

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function rowToExpense(r: Row): Expense {
  return {
    id: r.id,
    job_id: r.job_id,
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name ?? "",
    category_id: r.category_id,
    amount: r.amount,
    expense_date: r.expense_date,
    payment_method: (r.payment_method as Expense["payment_method"]) ?? "other",
    description: r.description,
    receipt_path: r.receipt_path,
    thumbnail_path: r.thumbnail_path,
    submitted_by: r.submitted_by,
    submitter_name: r.submitter_name ?? "",
    activity_id: null,
    created_at: r.created_at,
    updated_at: r.created_at,
    category: r.expense_categories
      ? {
          id: r.category_id,
          name: r.expense_categories.name,
          display_label: r.expense_categories.display_label,
          bg_color: r.expense_categories.bg_color,
          text_color: r.expense_categories.text_color,
          icon: null,
          sort_order: 0,
          is_default: false,
          created_at: "",
          updated_at: "",
        }
      : null,
  };
}

export default function GlobalExpensesTab({ range }: { range: RangePreset }) {
  const [data, setData] = useState<{
    rows: Row[];
    summary: { total: number; count: number; jobs: number };
  } | null>(null);
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);

  function load() {
    fetch(`/api/accounting/expenses?range=${range}`)
      .then((r) => r.json())
      .then(setData);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Platform expenses only — QuickBooks tracks overhead separately
      </p>
      {data && (
        <div className="text-sm">
          <span className="font-medium tabular-nums">Total: {fmt(data.summary.total)}</span>
          <span className="text-muted-foreground">
            {" "}across {data.summary.count} expenses on {data.summary.jobs} jobs
          </span>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 w-12"></th>
              <th className="text-left px-3 py-2">Vendor</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Job</th>
              <th className="text-left px-3 py-2">Submitted by</th>
              <th className="text-right px-3 py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  No expenses in this period
                </td>
              </tr>
            )}
            {(data?.rows ?? []).map((r) => (
              <tr
                key={r.id}
                className="border-t border-border hover:bg-muted/20 cursor-pointer"
                onClick={() => setSelectedRow(r)}
              >
                <td className="px-3 py-2">
                  {r.thumbnail_path ? (
                    <ThumbnailImg expenseId={r.id} />
                  ) : (
                    <div className="h-8 w-8 rounded bg-muted" />
                  )}
                </td>
                <td className="px-3 py-2">{r.vendor_name ?? "—"}</td>
                <td className="px-3 py-2">
                  {r.expense_categories && (
                    <span
                      className="inline-flex rounded px-2 py-0.5 text-xs"
                      style={soften(r.expense_categories.bg_color, r.expense_categories.text_color)}
                    >
                      {r.expense_categories.display_label}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{r.expense_date}</td>
                <td className="px-3 py-2">
                  {r.jobs && (
                    <Link
                      href={`/jobs/${r.jobs.id}?tab=financials`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {r.jobs.property_address ?? r.jobs.job_number}
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2">{r.submitter_name ?? "—"}</td>
                <td className="text-right px-3 py-2 tabular-nums">{fmt(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ReceiptDetailModal
        open={!!selectedRow}
        onOpenChange={(o) => { if (!o) setSelectedRow(null); }}
        expense={selectedRow ? rowToExpense(selectedRow) : null}
        onChanged={load}
      />
    </div>
  );
}

function ThumbnailImg({ expenseId }: { expenseId: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/expenses/${expenseId}/thumbnail-url`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.url) setSrc(j.url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [expenseId]);

  if (!src) return <div className="h-8 w-8 rounded bg-muted animate-pulse" />;
  return <img src={src} alt="" className="h-8 w-8 rounded object-cover" />;
}
