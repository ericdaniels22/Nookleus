"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
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
import {
  flattenSeriesToRows,
  monthsInSeries,
  type InsightDailySeries,
} from "@/lib/insights/series";
import { costPerLeadBySource } from "@/lib/insights/cost-per-lead";

Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

// Human labels for the source tags the store records.
const SOURCE_LABELS: Record<InsightMetricSource, string> = {
  business_profile: "Business Profile",
  search_console: "Search Console",
  google_ads: "Google Ads",
  local_services_ads: "Local Services Ads",
};

// The order sources appear in, top to bottom: the free Google feeds first (the
// history view leads with them), then the paid feeds.
const SOURCE_ORDER: InsightMetricSource[] = [
  "business_profile",
  "search_console",
  "google_ads",
  "local_services_ads",
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

// "2026-05" → "May 2026", for the cost-per-lead month picker.
function formatMonth(month: string): string {
  const [year, mm] = month.split("-");
  return `${MONTHS[Number(mm) - 1]} ${year}`;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

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

// Cost-per-lead by source for one month (#610). Flattens the series the tab
// already fetched and derives the read-time ratio per source — paid feeds
// (Google Ads, Local Services Ads) and the free Business Profile calls side by
// side. The hard part lives in costPerLeadBySource; this is the thin render:
//   - spend is always shown (a paid source's wasted money stays visible),
//   - the cost per lead is an em dash when there were no leads to divide by —
//     never a divide-by-zero, never a fake $0.00,
//   - a free source with calls is a true $0.00 (it earned leads for nothing).
// A month with no spend and no leads from any cost-bearing source shows an empty
// state rather than a table of zeroes.
export function CostPerLeadPanel({
  series,
  month,
}: {
  series: InsightDailySeries[];
  month: string;
}) {
  const rows = useMemo(
    () => costPerLeadBySource(flattenSeriesToRows(series), month),
    [series, month],
  );

  if (rows.length === 0) {
    return (
      <div className="text-center py-8 border border-dashed border-border rounded-xl">
        <p className="text-sm text-muted-foreground mb-1">
          No cost-per-lead data for this month
        </p>
        <p className="text-xs text-muted-foreground/60">
          Ad spend and Business Profile calls will appear here once a paid or
          free source records activity.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="text-base font-semibold text-foreground mb-3">
        Cost per lead
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="text-left px-3 py-2">Source</th>
              <th scope="col" className="text-right px-3 py-2">Spend</th>
              <th scope="col" className="text-right px-3 py-2">Leads</th>
              <th scope="col" className="text-right px-3 py-2 whitespace-nowrap">
                Cost per lead
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.source} className="border-t border-border">
                <th
                  scope="row"
                  className="px-3 py-2 text-left font-normal text-foreground"
                >
                  {SOURCE_LABELS[row.source]}
                </th>
                <td className="text-right px-3 py-2 tabular-nums">
                  {usd.format(row.spend)}
                </td>
                <td className="text-right px-3 py-2 tabular-nums">
                  {row.leads.toLocaleString("en-US")}
                </td>
                <td className="text-right px-3 py-2 tabular-nums">
                  {row.costPerLead === null ? "—" : usd.format(row.costPerLead)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// The Marketing → Insights tab. Reads this Organization's day-level metric
// history from the admin-only read route and renders both sources.
export default function MarketingInsightsTab() {
  const [series, setSeries] = useState<InsightDailySeries[]>([]);
  const [loading, setLoading] = useState(true);
  // The month the cost-per-lead picker is set to, or null while it tracks the
  // default. The effective month is derived below — no effect needed to keep it
  // valid as data loads.
  const [monthOverride, setMonthOverride] = useState<string | null>(null);

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

  const months = useMemo(() => monthsInSeries(series), [series]);
  // Default to the freshest month; honor the user's pick only while it still has
  // data (a reload that drops the chosen month falls back to the latest). This
  // derivation replaces a default-setting effect, so there's no stale flash.
  const month =
    monthOverride && months.includes(monthOverride)
      ? monthOverride
      : months[0] ?? "";

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
        <div className="space-y-8">
          {months.length > 0 && (
            <div>
              <div className="flex items-center justify-end mb-3">
                <label
                  htmlFor="cost-per-lead-month"
                  className="text-sm text-muted-foreground mr-2"
                >
                  Month
                </label>
                <select
                  id="cost-per-lead-month"
                  value={month}
                  onChange={(e) => setMonthOverride(e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                >
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {formatMonth(m)}
                    </option>
                  ))}
                </select>
              </div>
              <CostPerLeadPanel series={series} month={month} />
            </div>
          )}
          <InsightsDashboard series={series} />
        </div>
      )}
    </div>
  );
}
