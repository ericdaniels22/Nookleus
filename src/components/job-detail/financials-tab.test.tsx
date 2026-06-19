import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import FinancialsTab from "./financials-tab";

// The Billing and Expenses sections fetch live data / need auth context; this
// slice only touches the summary row, so stub them out to keep the render pure.
vi.mock("@/components/billing/billing-section", () => ({ default: () => null }));
vi.mock("@/components/expenses/expenses-section", () => ({ default: () => null }));

type Summary = {
  invoiced: number;
  collected: number;
  expenses: number;
  crew_labor: number;
  gross_margin: number;
  margin_pct: number | null;
  in_progress: boolean;
};

function renderTab(summary: Partial<Summary> = {}) {
  return render(
    <FinancialsTab
      jobId="job-1"
      payments={[]}
      invoices={[]}
      summary={{
        invoiced: 0,
        collected: 0,
        expenses: 0,
        crew_labor: 0,
        gross_margin: 0,
        margin_pct: null,
        in_progress: false,
        ...summary,
      }}
      onPaymentRecorded={() => {}}
      onExpenseLogged={() => {}}
    />,
  );
}

// #715 — the headline figure is "Profit", coloured by sign on both the number
// and the card tint, on the four-across summary row (desktop). Scoped to the
// desktop region since the same labels now also appear in the phone waterfall.
describe("FinancialsTab desktop summary figure", () => {
  it("labels the headline figure 'Profit', not 'Gross margin'", () => {
    renderTab({ gross_margin: 1200, margin_pct: 34, in_progress: false });

    const cards = within(screen.getByTestId("summary-cards"));
    expect(cards.getByText("Profit")).toBeTruthy();
    expect(cards.queryByText("Gross margin")).toBeNull();
  });

  it("renders a negative Profit red — figure and card tint — not green", () => {
    renderTab({ gross_margin: -800, margin_pct: -20, in_progress: false });

    const cards = within(screen.getByTestId("summary-cards"));
    const value = cards.getByText("-$800");
    expect(value.style.color).toBe("rgb(240, 149, 149)"); // #F09595

    const card = cards.getByText("Profit").closest(".rounded-lg") as HTMLElement;
    expect(card.style.background).toContain("rgba(240, 149, 149"); // red tint
  });

  it("renders a positive Profit green with a profit-percent caption", () => {
    renderTab({ gross_margin: 3400, margin_pct: 34, in_progress: false });

    const cards = within(screen.getByTestId("summary-cards"));
    const value = cards.getByText("$3,400");
    expect(value.style.color).toBe("rgb(93, 202, 165)"); // #5DCAA5

    const card = cards.getByText("Profit").closest(".rounded-lg") as HTMLElement;
    expect(card.style.background).toContain("rgba(29, 158, 117"); // green tint
    expect(cards.getByText("34.0% profit")).toBeTruthy();
  });

  it("captions an in-progress Job '(in progress)'", () => {
    renderTab({ gross_margin: 3400, margin_pct: 34, in_progress: true });

    const cards = within(screen.getByTestId("summary-cards"));
    expect(cards.getByText("(in progress)")).toBeTruthy();
    expect(cards.queryByText("34.0% profit")).toBeNull();
  });
});

// #716 — on the phone the four-across is replaced (via a CSS breakpoint) by a
// cash-flow waterfall; the desktop four-across stays.
describe("FinancialsTab phone cash-flow waterfall", () => {
  it("renders the waterfall on phone (below lg) and keeps the four-across for desktop", () => {
    renderTab({ collected: 1000, expenses: 300, crew_labor: 0, gross_margin: 700, margin_pct: 70 });

    const waterfall = screen.getByTestId("cashflow-waterfall");
    const cards = screen.getByTestId("summary-cards");

    // layout switches on viewport width (CSS), not a JS platform/Capacitor check
    expect(waterfall.className).toContain("lg:hidden");
    expect(cards.className).toContain("hidden");
    expect(cards.className).toContain("lg:grid");

    const w = within(waterfall);
    expect(w.getByText("Collected")).toBeTruthy();
    expect(w.getByText("Expenses")).toBeTruthy();
    expect(w.getByText("Profit")).toBeTruthy();
  });

  it("shows a '(est.)' Crew labor line and full seven-figure amounts, right-aligned", () => {
    renderTab({
      collected: 1_500_000,
      expenses: 200_000,
      crew_labor: 300_000,
      gross_margin: 1_000_000,
      margin_pct: 66.7,
    });

    const w = within(screen.getByTestId("cashflow-waterfall"));
    expect(w.getByText("Crew labor")).toBeTruthy();
    expect(w.getByText("(est.)")).toBeTruthy();

    // full precision — never abbreviated to $1.5M / $1M — and right-aligned
    const collectedValue = w.getByText("$1,500,000");
    expect(collectedValue.className).toContain("text-right");
    expect(w.getByText("$1,000,000")).toBeTruthy(); // Profit subtotal, in full
  });

  it("colours a negative Profit subtotal red in the waterfall", () => {
    renderTab({ collected: 100, expenses: 900, crew_labor: 0, gross_margin: -800, margin_pct: -800 });

    const w = within(screen.getByTestId("cashflow-waterfall"));
    const profitValue = w.getByText("-$800");
    expect(profitValue.style.color).toBe("rgb(240, 149, 149)"); // #F09595
  });
});

// #717 — above the waterfall (phone only), a collection ring shows how much of
// what's been Invoiced has been Collected, with the two common states.
describe("FinancialsTab phone collection ring", () => {
  it("draws the ring (phone only) with Outstanding when Invoiced > 0", () => {
    renderTab({ invoiced: 1000, collected: 600 });

    const block = screen.getByTestId("collection-ring");
    // same CSS-breakpoint split as the waterfall — phone only, no JS check
    expect(block.className).toContain("lg:hidden");
    // a hand-rolled SVG arc, not a charting dependency
    expect(block.querySelector("svg")).not.toBeNull();

    const ring = within(block);
    expect(ring.getByText("Outstanding")).toBeTruthy();
    expect(ring.getByText("$400")).toBeTruthy(); // Invoiced − Collected
  });

  it("draws no ring and reads 'Collected $X · not invoiced yet' when Invoiced is $0", () => {
    renderTab({ invoiced: 0, collected: 500 }); // a deposit before billing

    const block = screen.getByTestId("collection-ring");
    expect(block.querySelector("svg")).toBeNull(); // no ring

    const ring = within(block);
    expect(ring.getByText("Collected $500")).toBeTruthy();
    expect(ring.getByText(/not invoiced yet/)).toBeTruthy();
  });

  it("clamps an over-collected Job to a full ring with no negative Outstanding", () => {
    renderTab({ invoiced: 1000, collected: 1200 }); // paid ahead

    const block = screen.getByTestId("collection-ring");
    expect(block.querySelector("svg")).not.toBeNull(); // a full ring, no error

    // Outstanding would be negative here, so it is omitted (not "-$200")
    const ring = within(block);
    expect(ring.queryByText(/Outstanding/)).toBeNull();
    expect(ring.queryByText(/-\$/)).toBeNull();
  });
});
