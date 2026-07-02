"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MarginPctPill } from "./margin-pill";
import type { RangePreset } from "@/lib/accounting/date-ranges";
import type { JobMargin } from "@/lib/accounting/margins";

type Row = JobMargin & {
  damage_type: string | null;
  property_address: string | null;
  customer_name: string | null;
  margin_band: string;
};
type Filter = "all" | "active" | "completed";

const SORTS = [
  { value: "margin_desc", label: "Margin $ ↓" },
  { value: "margin_pct_desc", label: "Margin % ↓" },
  { value: "revenue_desc", label: "Revenue ↓" },
  { value: "expenses_desc", label: "Expenses ↓" },
  { value: "recent", label: "Recent" },
];

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function JobProfitabilityTab({ range }: { range: RangePreset }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState("margin_desc");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  useEffect(() => {
    setRows(null);
    setPage(0);
    fetch(`/api/accounting/profitability?range=${range}&filter=${filter}&sort=${sort}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []));
  }, [range, filter, sort]);

  const view = rows?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];
  const total = rows?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {(["all", "active", "completed"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm capitalize ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {f === "all" ? "All jobs" : f}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Job</th>
              <th className="text-right px-3 py-2">Invoiced</th>
              <th className="text-right px-3 py-2">Collected</th>
              <th className="text-right px-3 py-2">Expenses</th>
              <th className="text-right px-3 py-2">Margin</th>
              <th className="text-right px-3 py-2">%</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={6} className="text-center px-3 py-8 text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {view.map((r) => (
              <tr key={r.jobId} className="border-t border-border hover:bg-muted/20">
                <td className="px-3 py-2">
                  <Link href={`/jobs/${r.jobId}?tab=financials`} className="block">
                    <div className="flex items-center gap-2">
                      {r.damage_type && (
                        <span className="text-xs rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
                          {r.damage_type}
                        </span>
                      )}
                      <span className="truncate">{r.customer_name ?? r.property_address ?? r.jobNumber}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{r.jobNumber}</div>
                  </Link>
                </td>
                <td className="text-right px-3 py-2 tabular-nums">{fmt(r.invoiced)}</td>
                <td className="text-right px-3 py-2 tabular-nums">{fmt(r.collected)}</td>
                <td className="text-right px-3 py-2 tabular-nums">{fmt(r.expenses)}</td>
                <td className="text-right px-3 py-2 tabular-nums">
                  {fmt(r.gross_margin)}
                  {r.in_progress && (
                    <span className="ml-1 text-xs text-muted-foreground" title="In progress">
                      ↻
                    </span>
                  )}
                </td>
                <td className="text-right px-3 py-2">
                  <MarginPctPill pct={r.margin_pct} />
                </td>
              </tr>
            ))}
            {rows !== null && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center px-3 py-8 text-muted-foreground">
                  No jobs with activity in this range
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded px-2 py-1 disabled:opacity-30 hover:bg-muted"
            >
              Prev
            </button>
            <button
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
              className="rounded px-2 py-1 disabled:opacity-30 hover:bg-muted"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
