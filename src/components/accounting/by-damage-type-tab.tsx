"use client";

import { useEffect, useState } from "react";
import type { RangePreset } from "@/lib/accounting/date-ranges";
import { Bar } from "react-chartjs-2";
import { Chart, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from "chart.js";
import { damageTypeColors } from "@/lib/badge-colors";

Chart.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

type Row = {
  damage_type: string;
  job_count: number;
  revenue: number;
  expenses: number;
  margin: number;
  avg_margin_pct: number | null;
};

// damageTypeColors values are Tailwind class strings like "bg-sky-100 text-sky-800 ring-1 ring-sky-200".
// Extract the Tailwind color family name (e.g. "sky") from the text-* class, then map to a
// chart-safe hex so Chart.js can render the bars. This keeps damageTypeColors as the single
// source of truth for which color family each damage type belongs to.
const TAILWIND_HEX: Record<string, string> = {
  sky: "#0EA5E9",
  orange: "#F97316",
  lime: "#84CC16",
  violet: "#8B5CF6",
  rose: "#F43F5E",
  red: "#EF4444",
  yellow: "#EAB308",
  stone: "#78716C",
};

function colorFor(damageType: string): string {
  const classes = damageTypeColors[damageType] ?? "";
  // Match the color family from the "text-<color>-<shade>" class
  const match = classes.match(/text-([a-z]+)-\d+/);
  if (match) {
    const family = match[1];
    if (family in TAILWIND_HEX) return TAILWIND_HEX[family];
  }
  return "#6B7280";
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function ByDamageTypeTab({ range }: { range: RangePreset }) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    fetch(`/api/accounting/damage-type?range=${range}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []));
  }, [range]);

  const chartData = {
    labels: rows.map((r) => r.damage_type),
    datasets: [
      {
        label: "Average margin %",
        data: rows.map((r) => r.avg_margin_pct ?? 0),
        backgroundColor: rows.map((r) => colorFor(r.damage_type)),
        borderWidth: 0,
      },
    ],
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Damage type</th>
              <th className="text-right px-3 py-2">Jobs</th>
              <th className="text-right px-3 py-2">Revenue</th>
              <th className="text-right px-3 py-2">Expenses</th>
              <th className="text-right px-3 py-2">Margin</th>
              <th className="text-right px-3 py-2">Avg margin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.damage_type} className="border-t border-border">
                <td className="px-3 py-2">
                  <span
                    className="inline-flex rounded px-2 py-0.5 text-xs"
                    style={{ background: `${colorFor(r.damage_type)}30`, color: colorFor(r.damage_type) }}
                  >
                    {r.damage_type}
                  </span>
                </td>
                <td className="text-right px-3 py-2">{r.job_count}</td>
                <td className="text-right px-3 py-2">{fmt(r.revenue)}</td>
                <td className="text-right px-3 py-2">{fmt(r.expenses)}</td>
                <td className="text-right px-3 py-2">{fmt(r.margin)}</td>
                <td className="text-right px-3 py-2">
                  {r.avg_margin_pct !== null ? `${r.avg_margin_pct.toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center px-3 py-8 text-muted-foreground">
                  No data in this range
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="text-sm mb-2">Average margin % by damage type</div>
        <div style={{ height: 320 }}>
          <Bar
            data={chartData}
            options={{
              indexAxis: "y",
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { grid: { color: "#262626" }, ticks: { color: "#a3a3a3" } },
                y: { grid: { display: false }, ticks: { color: "#a3a3a3" } },
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
