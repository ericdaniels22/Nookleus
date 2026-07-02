import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import StatCards from "./stat-cards";

const SUMMARY = {
  revenue: {
    current: 12000,
    prior: 10000,
    delta: { amount: 2000, pct: 20, direction: "up" as const },
  },
  expenses: { current: 8000, pctOfRevenue: 66.7 },
  grossMargin: { amount: 4000, pct: 33.3, crew_labor: 500 },
  outstandingAR: { amount: 3000, overSixty: 1500 },
};

function mockSummary(s: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => s })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<StatCards> §3 tabular numerals", () => {
  it("renders metric values with tabular-nums so digits align", async () => {
    mockSummary(SUMMARY);
    const { findByText } = render(<StatCards range="last_30" />);

    const revenueValue = await findByText("$12,000");
    expect(revenueValue.className).toContain("tabular-nums");
  });
});

describe("<StatCards> §2 token colors", () => {
  it("colors the delta with a palette class, not an inline hex", async () => {
    mockSummary(SUMMARY);
    const { findByText } = render(<StatCards range="last_30" />);

    const delta = await findByText(/20\.0% vs prior/);
    // §2 — up delta reads from the emerald accent family via a class, never an
    // inline hex color.
    expect(delta.getAttribute("style")).toBeFalsy();
    expect(delta.className).toContain("emerald");
  });

  it("does not paint any card with an inline hex background", async () => {
    mockSummary(SUMMARY);
    const { findByText } = render(<StatCards range="last_30" />);
    await findByText("$12,000");

    // No element in the tree should carry a raw #hex or rgba() inline color.
    for (const el of document.querySelectorAll<HTMLElement>("[style]")) {
      const style = el.getAttribute("style") ?? "";
      expect(style).not.toMatch(/#[0-9a-fA-F]{3,6}/);
      expect(style).not.toMatch(/rgba?\(/);
    }
  });
});
