"use client";

import { useEffect, useState, useCallback } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import type { InsightMetricSource } from "@/lib/insights/metrics-store";
import type { InsightDailySeries } from "@/lib/insights/series";

Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

// Human labels for the source tags the store records. New sources (Ads, Local
// Services Ads) are added here as later slices land.
const SOURCE_LABELS: Record<InsightMetricSource, string> = {
  business_profile: "Business Profile",
  search_console: "Search Console",
};

// The order sources appear in, top to bottom.
const SOURCE_ORDER: InsightMetricSource[] = [
  "business_profile",
  "search_console",
];

const LINE_COLORS = ["#2DD4BF", "#F59E0B", "#60A5FA", "#A78BFA", "#F472B6"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// "website_clicks" → "Website clicks". The store's metric names are snake_case;
// the screen shows them sentence-cased.
function metricLabel(metric: string): string {
  const spaced = metric.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// "2026-06-25" → "Jun 25", formatted from the ISO parts (no Date) so it never
// drifts a day across the local timezone.
function formatDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}`;
}

// One source's day-level history: a line chart of its metrics over the window,
// plus the same numbers as an accessible day-by-day table.
function InsightSourcePanel({
  source,
  series,
}: {
  source: InsightMetricSource;
  series: InsightDailySeries[];
}) {
  // The aligned date columns: the ascending union of every metric's days.
  const dates = [
    ...new Set(series.flatMap((s) => s.points.map((p) => p.date))),
  ].sort((a, b) => a.localeCompare(b));

  const valueByMetricDate = new Map<string, Map<string, number>>();
  for (const s of series) {
    const byDate = new Map<string, number>();
    for (const point of s.points) byDate.set(point.date, point.value);
    valueByMetricDate.set(s.metric, byDate);
  }

  const chartData = {
    labels: dates.map(formatDay),
    datasets: series.map((s, i) => ({
      label: metricLabel(s.metric),
      data: dates.map((d) => valueByMetricDate.get(s.metric)?.get(d) ?? null),
      borderColor: LINE_COLORS[i % LINE_COLORS.length],
      backgroundColor: LINE_COLORS[i % LINE_COLORS.length],
      tension: 0.3,
      spanGaps: true,
    })),
  };

  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="text-base font-semibold text-foreground mb-3">
        {SOURCE_LABELS[source]}
      </h3>
      <div style={{ height: 260 }} className="mb-4">
        <Line
          data={chartData}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: "bottom" } },
            scales: {
              x: { grid: { color: "#262626" }, ticks: { color: "#a3a3a3" } },
              y: { grid: { color: "#262626" }, ticks: { color: "#a3a3a3" } },
            },
          }}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="text-left px-3 py-2">Metric</th>
              {dates.map((d) => (
                <th
                  key={d}
                  scope="col"
                  className="text-right px-3 py-2 whitespace-nowrap"
                >
                  {formatDay(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.metric} className="border-t border-border">
                <th
                  scope="row"
                  className="px-3 py-2 text-left font-normal text-foreground"
                >
                  {metricLabel(s.metric)}
                </th>
                {dates.map((d) => {
                  const value = valueByMetricDate.get(s.metric)?.get(d);
                  return (
                    <td key={d} className="text-right px-3 py-2 tabular-nums">
                      {value === undefined ? "—" : value.toLocaleString("en-US")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Pure presentational dashboard: both sources, each with day-level history. Order
// is decided here (SOURCE_ORDER); the points arrive already sorted ascending from
// toDailySeries.
export function InsightsDashboard({
  series,
}: {
  series: InsightDailySeries[];
}) {
  if (series.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-border rounded-xl">
        <p className="text-sm text-muted-foreground mb-1">No insights yet</p>
        <p className="text-xs text-muted-foreground/60">
          Business Profile and Search Console metrics will appear here after the
          next daily sync.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {SOURCE_ORDER.map((source) => {
        const sourceSeries = series.filter((s) => s.source === source);
        if (sourceSeries.length === 0) return null;
        return (
          <InsightSourcePanel
            key={source}
            source={source}
            series={sourceSeries}
          />
        );
      })}
    </div>
  );
}

// The Marketing → Insights tab. Reads this Organization's day-level metric
// history from the admin-only read route and renders both sources.
export default function MarketingInsightsTab() {
  const [series, setSeries] = useState<InsightDailySeries[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/marketing/insights");
      const data = await res.json();
      setSeries(data.series ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Insights</h2>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Loading insights...
        </p>
      ) : (
        <InsightsDashboard series={series} />
      )}
    </div>
  );
}
