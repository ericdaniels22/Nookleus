"use client";

import { useEffect, useState } from "react";
import type { RangePreset } from "@/lib/accounting/date-ranges";
import { Bar } from "react-chartjs-2";
import { Chart, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from "chart.js";
import { damageTypeColors } from "@/lib/badge-colors";
import { getChartPalette } from "@/lib/charts/palette";

Chart.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

type Row = {
  damage_type: string;
  job_count: number;
  revenue: number;
  expenses: number;
  margin: number;
  avg_margin_pct: number | null;
};

// §2.6 damage-type tint class for a type; neutral pair for anything the
// canonical map doesn't cover (a per-org custom type).
function pillClass(damageType: string): string {
  return damageTypeColors[damageType] ?? damageTypeColors.other;
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

  // §2.7 — series colors from the shared chart palette (--chart-1…5), read from
  // CSS at runtime. This single-series categorical chart identifies each bar by
  // its y-axis label + the table pill above; the bars themselves cycle the slots.
  const palette = getChartPalette();

  const chartData = {
    labels: rows.map((r) => r.damage_type),
    datasets: [
      {
        label: "Average margin %",
        data: rows.map((r) => r.avg_margin_pct ?? 0),
        backgroundColor: rows.map((_, i) => palette.series[i % palette.series.length]),
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
                  <span className={`inline-flex rounded px-2 py-0.5 text-xs ${pillClass(r.damage_type)}`}>
                    {r.damage_type}
                  </span>
                </td>
                <td className="text-right px-3 py-2 tabular-nums">{r.job_count}</td>
                <td className="text-right px-3 py-2 tabular-nums">{fmt(r.revenue)}</td>
                <td className="text-right px-3 py-2 tabular-nums">{fmt(r.expenses)}</td>
                <td className="text-right px-3 py-2 tabular-nums">{fmt(r.margin)}</td>
                <td className="text-right px-3 py-2 tabular-nums">
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
              plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: palette.tooltip },
              },
              scales: {
                x: { grid: { color: palette.grid }, ticks: { color: palette.axis } },
                y: { grid: { display: false }, ticks: { color: palette.axis } },
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
