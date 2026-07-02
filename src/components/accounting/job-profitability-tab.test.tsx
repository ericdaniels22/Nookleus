import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import JobProfitabilityTab from "./job-profitability-tab";

function mockRows(rows: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({ rows }) })),
  );
}

const SAMPLE = [
  {
    jobId: "j1",
    jobNumber: "24-001",
    invoiced: 5000,
    collected: 4000,
    expenses: 1500,
    gross_margin: 2500,
    margin_pct: 62.5,
    in_progress: false,
    damage_type: "water",
    property_address: "1 Main St",
    customer_name: "Jane Doe",
    margin_band: "green",
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<JobProfitabilityTab> tabular numerals (§3)", () => {
  it("renders money columns with tabular-nums so digits align", async () => {
    mockRows(SAMPLE);

    const { findByText } = render(<JobProfitabilityTab range="last_30" />);

    const invoicedCell = await findByText("$5,000");
    expect(invoicedCell.className).toContain("tabular-nums");
  });
});
