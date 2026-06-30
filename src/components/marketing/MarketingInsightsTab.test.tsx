import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { InsightDailySeries } from "@/lib/insights/series";

// chart.js needs a real <canvas> (jsdom has none); the dashboard's day-level
// history is asserted through the accessible table, so the chart is a stub here.
vi.mock("react-chartjs-2", () => ({
  Line: () => null,
}));

import MarketingInsightsTab, {
  InsightsDashboard,
  CostPerLeadPanel,
} from "./MarketingInsightsTab";

function series(over: Partial<InsightDailySeries> = {}): InsightDailySeries {
  return {
    source: "business_profile",
    metric: "calls",
    points: [
      { date: "2026-06-24", value: 9 },
      { date: "2026-06-25", value: 12 },
    ],
    ...over,
  };
}

// #607 — the Marketing → Insights tab. The acceptance criterion that matters
// here: both sources are shown with day-level history, not just a snapshot.
describe("<InsightsDashboard>", () => {
  it("renders every day's value for a metric, not just the latest snapshot", () => {
    render(<InsightsDashboard series={[series()]} />);
    // Both days are present — this is history, not a single number.
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("shows the empty-state copy when there are no metrics yet", () => {
    render(<InsightsDashboard series={[]} />);
    expect(screen.getByText("No insights yet")).toBeTruthy();
  });

  it("groups the history under both source headings", () => {
    render(
      <InsightsDashboard
        series={[
          series({ source: "business_profile", metric: "calls" }),
          series({ source: "search_console", metric: "clicks" }),
        ]}
      />,
    );
    expect(screen.getByText("Business Profile")).toBeTruthy();
    expect(screen.getByText("Search Console")).toBeTruthy();
  });

  it("sentence-cases the snake_case metric names", () => {
    render(
      <InsightsDashboard
        series={[
          series({ source: "business_profile", metric: "website_clicks" }),
          series({ source: "search_console", metric: "impressions" }),
        ]}
      />,
    );
    expect(screen.getByText("Website clicks")).toBeTruthy();
    expect(screen.getByText("Impressions")).toBeTruthy();
  });

  it("renders a metric's value under the matching day column", () => {
    render(
      <InsightsDashboard
        series={[
          series({
            metric: "calls",
            points: [
              { date: "2026-06-24", value: 9 },
              { date: "2026-06-25", value: 12 },
            ],
          }),
        ]}
      />,
    );
    // The header row carries both day columns; the body row carries the values.
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Metric", "Jun 24", "Jun 25"]);
  });

  it("exposes each metric label as a row header for assistive tech", () => {
    render(
      <InsightsDashboard series={[series({ metric: "website_clicks" })]} />,
    );
    const table = screen.getByRole("table");
    // The metric label heads its data row (<th scope="row">), so screen readers
    // announce it alongside each day's value — not a plain cell.
    expect(
      within(table).getByRole("rowheader", { name: "Website clicks" }),
    ).toBeTruthy();
  });
});

// #610 — cost-per-lead by source for a selected month. The acceptance criteria
// that matter here: paid and free sources side by side, and months with zero
// leads or missing sources render sensibly (no divide-by-zero, no fake zeros).
describe("<CostPerLeadPanel>", () => {
  it("shows a paid source's spend, leads and cost per lead for the month", () => {
    render(
      <CostPerLeadPanel
        month="2026-05"
        series={[
          series({ source: "google_ads", metric: "spend", points: [{ date: "2026-05-10", value: 400 }] }),
          series({ source: "google_ads", metric: "conversions", points: [{ date: "2026-05-10", value: 8 }] }),
        ]}
      />,
    );
    expect(screen.getByText("Google Ads")).toBeTruthy();
    // 400 / 8 = $50.00.
    expect(screen.getByText("$50.00")).toBeTruthy();
  });

  it("shows an em dash for a paid source that spent but got zero leads", () => {
    render(
      <CostPerLeadPanel
        month="2026-05"
        series={[
          series({ source: "google_ads", metric: "spend", points: [{ date: "2026-05-10", value: 250 }] }),
        ]}
      />,
    );
    const table = screen.getByRole("table");
    const cells = within(table).getAllByRole("cell").map((c) => c.textContent);
    // The spend is shown so the wasted money is visible; the cost-per-lead is a
    // dash — never a divide-by-zero, never a fake $0.00.
    expect(cells).toContain("$250.00");
    expect(cells).toContain("—");
    expect(cells).not.toContain("$0.00");
  });

  it("renders Business Profile calls as free leads at $0.00", () => {
    render(
      <CostPerLeadPanel
        month="2026-05"
        series={[
          series({ source: "business_profile", metric: "calls", points: [{ date: "2026-05-10", value: 20 }] }),
        ]}
      />,
    );
    expect(screen.getByText("Business Profile")).toBeTruthy();
    const table = screen.getByRole("table");
    const cells = within(table).getAllByRole("cell").map((c) => c.textContent);
    // Free leads: the spend is a true $0.00 and so is the cost per lead — the
    // call still counts as a lead, it just cost nothing. Never a dash here.
    expect(cells).toEqual(["$0.00", "20", "$0.00"]);
  });

  it("shows an empty state when the month has no paid or lead activity", () => {
    render(
      <CostPerLeadPanel
        month="2026-05"
        series={[
          // Search Console traffic is history, not a lead — so this month has no
          // cost-per-lead rows to show.
          series({ source: "search_console", metric: "clicks", points: [{ date: "2026-05-10", value: 500 }] }),
        ]}
      />,
    );
    expect(screen.getByText(/no .*lead/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("<MarketingInsightsTab>", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches /api/marketing/insights and renders the day-level history", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ series: [series()] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MarketingInsightsTab />);

    expect(await screen.findByText("12")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/marketing/insights");
  });

  it("defaults the cost-per-lead month picker to the freshest month with data", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        series: [
          series({
            source: "google_ads",
            metric: "spend",
            points: [
              { date: "2026-05-10", value: 400 },
              { date: "2026-06-10", value: 300 },
            ],
          }),
          series({
            source: "google_ads",
            metric: "conversions",
            points: [
              { date: "2026-05-10", value: 8 },
              { date: "2026-06-10", value: 5 },
            ],
          }),
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MarketingInsightsTab />);

    // The picker defaults to the freshest month (June): 300 / 5 = $60.00, not
    // May's 400 / 8 = $50.00.
    expect(await screen.findByText("$60.00")).toBeTruthy();
    expect(screen.queryByText("$50.00")).toBeNull();

    // It offers every month that has data, latest first.
    const picker = screen.getByRole("combobox", { name: /month/i });
    const options = within(picker)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Jun 2026", "May 2026"]);
  });
});
