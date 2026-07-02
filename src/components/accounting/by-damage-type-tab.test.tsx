import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

// Capture the props Chart.js's <Bar> receives so we can assert the chart config
// is wired to the token palette (#911) rather than hardcoded hexes. jsdom has no
// <canvas>, so the real chart can't render — the stub records instead.
const barProps = vi.hoisted(() => ({ current: null as null | { data: any; options: any } }));
vi.mock("react-chartjs-2", () => ({
  Bar: (props: { data: any; options: any }) => {
    barProps.current = props;
    return null;
  },
}));

import ByDamageTypeTab from "./by-damage-type-tab";

const TOKENS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--border",
  "--muted-foreground",
  "--popover",
] as const;

function setToken(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

function mockRows(rows: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({ rows }) })),
  );
}

const SAMPLE = [
  { damage_type: "water", job_count: 3, revenue: 1200, expenses: 800, margin: 400, avg_margin_pct: 33.3 },
  { damage_type: "fire", job_count: 2, revenue: 900, expenses: 500, margin: 400, avg_margin_pct: 44.4 },
];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const t of TOKENS) document.documentElement.style.removeProperty(t);
  barProps.current = null;
});

describe("<ByDamageTypeTab> chart palette (§2.7)", () => {
  it("colors the bars from the chart palette slots, cycling --chart-1…5", async () => {
    setToken("--chart-1", "#111111");
    setToken("--chart-2", "#222222");
    mockRows(SAMPLE);

    render(<ByDamageTypeTab range="last_30" />);

    await waitFor(() => expect(barProps.current?.data.datasets[0].data).toHaveLength(2));
    // Two bars → the first two slots, in order. No damage-type→hex mapping.
    expect(barProps.current!.data.datasets[0].backgroundColor).toEqual(["#111111", "#222222"]);
  });

  it("reads grid from --border, axis ticks from --muted-foreground, tooltip from --popover", async () => {
    setToken("--border", "rgba(1, 2, 3, 0.1)");
    setToken("--muted-foreground", "#abcdef");
    setToken("--popover", "#0f0f0f");
    mockRows(SAMPLE);

    render(<ByDamageTypeTab range="last_30" />);

    await waitFor(() => expect(barProps.current?.data.datasets[0].data).toHaveLength(2));
    const opts = barProps.current!.options;
    expect(opts.scales.x.grid.color).toBe("rgba(1, 2, 3, 0.1)");
    expect(opts.scales.x.ticks.color).toBe("#abcdef");
    expect(opts.scales.y.ticks.color).toBe("#abcdef");
    expect(opts.plugins.tooltip.backgroundColor).toBe("#0f0f0f");
  });
});

describe("<ByDamageTypeTab> tabular numerals (§3)", () => {
  it("renders money and number columns with tabular-nums so digits align", async () => {
    mockRows(SAMPLE);

    const { findByText } = render(<ByDamageTypeTab range="last_30" />);

    // A money column…
    const revenueCell = await findByText("$1,200");
    expect(revenueCell.className).toContain("tabular-nums");
    // …and a numeric percent column.
    const marginPctCell = await findByText("33.3%");
    expect(marginPctCell.className).toContain("tabular-nums");
  });
});

describe("<ByDamageTypeTab> damage-type pill (§2.6)", () => {
  it("tints the pill with the §2.6 dark-tint class, not an inline hex", async () => {
    mockRows(SAMPLE);

    const { findByText } = render(<ByDamageTypeTab range="last_30" />);

    const pill = await findByText("water");
    // §2.6 water tint (bg-sky-400/14 text-sky-300) — a palette class, not a hex.
    expect(pill.className).toContain("text-sky-300");
    expect(pill.getAttribute("style")).toBeFalsy();
  });
});
