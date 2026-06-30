// Cost-per-lead by source (#610).
//
// The store holds spend and lead-signal rows per (source, metric, day). The
// Insights screen wants "what a lead cost last month from each source". This is
// a READ-TIME ratio — spend / leads — never a stored row: the store's value
// column is summed on conflict (collapseByConflictKey) and CHECK >= 0, so a
// stored ratio would be summed into nonsense. Computing it here keeps the store
// additive and the math honest.

import type { InsightMetricSource } from "./metrics-store";
import type { InsightMetricRow } from "./series";

// Which stored metric carries each source's spend and its "lead" signal. Paid
// feeds have both; the leads metric differs (Google Ads counts conversions,
// Local Services Ads counts leads). A source absent here contributes no
// cost-per-lead row — Search Console activity is shown as history, not leads.
interface SourceCostConfig {
  spendMetric?: string;
  leadMetric: string;
}

const SOURCE_COST_CONFIG: Partial<Record<InsightMetricSource, SourceCostConfig>> = {
  google_ads: { spendMetric: "spend", leadMetric: "conversions" },
  local_services_ads: { spendMetric: "spend", leadMetric: "leads" },
  // Free Google traffic. A phone call to the business is the lead; there is no
  // spend, so its cost-per-lead is a true 0 (free) whenever it has any calls.
  business_profile: { leadMetric: "calls" },
};

// The order sources appear in — paid feeds first (the money view), then free.
// The store read has no ORDER BY, so without an explicit order the panel rows
// would shuffle between loads.
const COST_PER_LEAD_SOURCE_ORDER: InsightMetricSource[] = [
  "google_ads",
  "local_services_ads",
  "business_profile",
];

export interface SourceCostPerLead {
  source: InsightMetricSource;
  spend: number;
  leads: number;
  // spend / leads, or null when there are no leads to divide by (no fake $0,
  // no divide-by-zero). A free source with leads is a true 0 — it costs nothing.
  costPerLead: number | null;
}

// Cost-per-lead per source for one month ("YYYY-MM"). Sums each source's spend
// and leads over the month's rows, then derives the ratio. Sources with no rows
// in the month are omitted (no fake-zero rows).
export function costPerLeadBySource(
  rows: InsightMetricRow[],
  month: string,
): SourceCostPerLead[] {
  const bySource = new Map<InsightMetricSource, { spend: number; leads: number }>();

  for (const row of rows) {
    if (row.metric_date.slice(0, 7) !== month) continue;
    const config = SOURCE_COST_CONFIG[row.source];
    if (!config) continue;

    const isSpend = !!config.spendMetric && row.metric === config.spendMetric;
    const isLead = row.metric === config.leadMetric;
    // A row that is neither the source's spend nor its lead signal — Business
    // Profile also reports website_clicks and direction_requests — is history,
    // not cost-per-lead input. It must not conjure a $0/0 entry for the source:
    // a month of page views with no calls and no spend has to stay empty, not
    // render a table of fake zeros.
    if (!isSpend && !isLead) continue;

    let totals = bySource.get(row.source);
    if (!totals) {
      totals = { spend: 0, leads: 0 };
      bySource.set(row.source, totals);
    }
    if (isSpend) {
      totals.spend += row.value;
    } else {
      totals.leads += row.value;
    }
  }

  return COST_PER_LEAD_SOURCE_ORDER.filter((source) => bySource.has(source)).map(
    (source) => {
      const { spend, leads } = bySource.get(source)!;
      return {
        source,
        spend,
        leads,
        costPerLead: leads > 0 ? spend / leads : null,
      };
    },
  );
}
