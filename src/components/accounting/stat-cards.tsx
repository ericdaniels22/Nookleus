"use client";

import { useEffect, useState } from "react";
import type { RangePreset } from "@/lib/accounting/date-ranges";

type Summary = {
  revenue: {
    current: number;
    prior: number;
    delta: { amount: number; pct: number | null; direction: "up" | "down" | "flat" } | null;
  };
  expenses: { current: number; pctOfRevenue: number | null };
  grossMargin: { amount: number; pct: number | null; crew_labor: number };
  outstandingAR: { amount: number; overSixty: number };
};

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function StatCards({ range }: { range: RangePreset }) {
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    fetch(`/api/accounting/summary?range=${range}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [range]);

  if (!data) {
    return (
      <div className="grid grid-cols-4 gap-3">
        <CardSkel />
        <CardSkel />
        <CardSkel />
        <CardSkel />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-3">
      <Card label="Revenue" value={fmt(data.revenue.current)}>
        {data.revenue.delta && data.revenue.delta.pct !== null && (
          <div
            className={`text-xs tabular-nums ${
              data.revenue.delta.direction === "up"
                ? "text-emerald-300"
                : data.revenue.delta.direction === "down"
                ? "text-red-300"
                : "text-muted-foreground"
            }`}
          >
            {data.revenue.delta.direction === "up" ? "▲" : data.revenue.delta.direction === "down" ? "▼" : "–"}{" "}
            {Math.abs(data.revenue.delta.pct).toFixed(1)}% vs prior
          </div>
        )}
      </Card>
      <Card label="Expenses" value={fmt(data.expenses.current)}>
        {data.expenses.pctOfRevenue !== null && (
          <div className="text-xs text-muted-foreground">{data.expenses.pctOfRevenue.toFixed(1)}% of revenue</div>
        )}
      </Card>
      <Card
        label="Gross margin*"
        value={fmt(data.grossMargin.amount)}
        highlight
        title="Estimate — includes manual crew labor cost where entered"
      >
        {data.grossMargin.pct !== null && (
          <div className="text-xs tabular-nums text-emerald-300">
            {data.grossMargin.pct.toFixed(1)}% margin
          </div>
        )}
      </Card>
      <Card label="Outstanding AR" value={fmt(data.outstandingAR.amount)}>
        {data.outstandingAR.overSixty > 0 && (
          <div className="text-xs tabular-nums text-warning">
            {fmt(data.outstandingAR.overSixty)} over 60 days
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({
  label,
  value,
  children,
  highlight,
  title,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  highlight?: boolean;
  title?: string;
}) {
  // §2.4 highlight = product-accent tint (--primary emerald); the neutral card
  // is a subtle white wash on the page surface — both as palette classes.
  const surface = highlight
    ? "bg-primary/12 border border-primary/35"
    : "bg-white/3 border border-white/8";
  return (
    <div className={`rounded-lg p-4 ${surface}`} title={title}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${highlight ? "text-primary" : ""}`}>
        {value}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function CardSkel() {
  return (
    <div className="rounded-lg p-4 animate-pulse bg-white/3 border border-white/8">
      <div className="h-4 w-16 rounded bg-muted" />
      <div className="mt-2 h-7 w-24 rounded bg-muted" />
    </div>
  );
}
