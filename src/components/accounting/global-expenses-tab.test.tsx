import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/components/expenses/receipt-detail-modal", () => ({ default: () => null }));

import GlobalExpensesTab from "./global-expenses-tab";

const DATA = {
  summary: { total: 999, count: 1, jobs: 1 },
  rows: [
    {
      id: "e1",
      job_id: "j1",
      vendor_id: null,
      vendor_name: "Home Depot",
      category_id: "c1",
      amount: 250,
      expense_date: "2026-06-01",
      payment_method: "card",
      description: null,
      receipt_path: null,
      thumbnail_path: null,
      submitted_by: null,
      submitter_name: "Sam",
      created_at: "2026-06-01",
      expense_categories: {
        name: "materials",
        display_label: "Materials",
        bg_color: "#123456",
        text_color: "#654321",
      },
      jobs: null,
    },
  ],
};

function mockData(d: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => d })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<GlobalExpensesTab> §3 tabular numerals", () => {
  it("renders the Amount cell and the Total with tabular-nums", async () => {
    mockData(DATA);
    const { findByText } = render(<GlobalExpensesTab range="last_30" />);

    const amount = await findByText("$250");
    expect(amount.className).toContain("tabular-nums");

    const total = await findByText(/Total: \$999/);
    expect(total.className).toContain("tabular-nums");
  });
});

describe("<GlobalExpensesTab> §2.6 category badge", () => {
  it("softens the per-org category color to a theme-safe tint, not the raw hex", async () => {
    mockData(DATA);
    const { findByText } = render(<GlobalExpensesTab range="last_30" />);

    const badge = await findByText("Materials");
    const style = badge.getAttribute("style") ?? "";
    // The stored bg becomes a low-alpha wash; the raw stored hex never reaches
    // the dark surface directly.
    expect(style).toContain("rgba(");
    expect(style).not.toContain("#123456");
  });
});
