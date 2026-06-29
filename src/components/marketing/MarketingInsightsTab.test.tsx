import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { InsightDailySeries } from "@/lib/insights/series";

// chart.js needs a real <canvas> (jsdom has none); the dashboard's day-level
// history is asserted through the accessible table, so the chart is a stub here.
vi.mock("react-chartjs-2", () => ({
  Line: () => null,
}));

import MarketingInsightsTab, { InsightsDashboard } from "./MarketingInsightsTab";

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
});
