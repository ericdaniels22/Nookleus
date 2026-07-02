// design-v2 step 3 (#913) — the dashboard KPI metric card per
// docs/design-system.md §5: --muted surface, label above value, tabular
// numerals, neutral value unless the metric is a warning. Optional link + a
// loading skeleton in the value slot. No jest-dom matchers — plain Vitest.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MetricCard } from "./metric-card";

describe("<MetricCard> (#913, design-system §5)", () => {
  it("renders the label and value on a muted surface", () => {
    const { container } = render(<MetricCard label="New jobs" value={3} />);

    expect(screen.getByText("New jobs")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect((container.firstChild as HTMLElement).className).toContain("bg-muted");
  });

  it("renders the value with tabular numerals, neutral by default", () => {
    render(<MetricCard label="New jobs" value={12} />);
    const value = screen.getByText("12");

    expect(value.className).toContain("tabular-nums");
    expect(value.className).toContain("text-foreground");
    expect(value.className).not.toContain("text-warning");
  });

  it("colors the value with the warning tone when the metric is a warning", () => {
    render(<MetricCard label="Outstanding" value="$4,200" tone="warning" />);
    const value = screen.getByText("$4,200");

    expect(value.className).toContain("text-warning");
    expect(value.className).not.toContain("text-foreground");
  });

  it("wraps the whole card in a link when href is given", () => {
    render(<MetricCard label="New jobs" value={3} href="/jobs" />);
    const link = screen.getByText("New jobs").closest("a");

    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/jobs");
  });

  it("shows a skeleton in the value slot while loading and hides the value", () => {
    const { container } = render(
      <MetricCard label="New jobs" value={3} loading />,
    );

    // The number is not rendered while loading...
    expect(screen.queryByText("3")).toBeNull();
    // ...a decorative skeleton block stands in its place.
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
});
