import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import FinancialsTab from "./financials-tab";

// The Billing and Expenses sections fetch live data / need auth context; this
// slice only touches the summary row, so stub them out to keep the render pure.
vi.mock("@/components/billing/billing-section", () => ({ default: () => null }));
vi.mock("@/components/expenses/expenses-section", () => ({ default: () => null }));

type Summary = {
  invoiced: number;
  collected: number;
  expenses: number;
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
// and the card tint, on the four-across summary row (phone + desktop).
describe("FinancialsTab summary figure", () => {
  it("labels the headline figure 'Profit', not 'Gross margin'", () => {
    renderTab({ gross_margin: 1200, margin_pct: 34, in_progress: false });

    expect(screen.getByText("Profit")).toBeTruthy();
    expect(screen.queryByText("Gross margin")).toBeNull();
  });

  it("renders a negative Profit red — figure and card tint — not green", () => {
    renderTab({ gross_margin: -800, margin_pct: -20, in_progress: false });

    const value = screen.getByText("-$800");
    expect(value.style.color).toBe("rgb(240, 149, 149)"); // #F09595

    const card = screen.getByText("Profit").closest(".rounded-lg") as HTMLElement;
    expect(card.style.background).toContain("rgba(240, 149, 149"); // red tint
  });

  it("renders a positive Profit green with a profit-percent caption", () => {
    renderTab({ gross_margin: 3400, margin_pct: 34, in_progress: false });

    const value = screen.getByText("$3,400");
    expect(value.style.color).toBe("rgb(93, 202, 165)"); // #5DCAA5

    const card = screen.getByText("Profit").closest(".rounded-lg") as HTMLElement;
    expect(card.style.background).toContain("rgba(29, 158, 117"); // green tint
    expect(screen.getByText("34.0% profit")).toBeTruthy();
  });

  it("captions an in-progress Job '(in progress)'", () => {
    renderTab({ gross_margin: 3400, margin_pct: 34, in_progress: true });

    expect(screen.getByText("(in progress)")).toBeTruthy();
    expect(screen.queryByText("34.0% profit")).toBeNull();
  });
});
