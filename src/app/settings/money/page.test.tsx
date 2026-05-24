import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// #230 — smoke test for the combined /settings/money shell. The four tab
// bodies are covered by their own tests (and the SettingsTabs unit tests
// cover URL syncing). This test only verifies that the shell wires up the
// four expected tabs in the right order and renders without crashing.
//
// The page is a server component; we don't await it here because the four
// tab modules are mocked out — only the shell composition is under test.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/money",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("./vendors-tab", () => ({ VendorsTab: () => <div>vendors-tab-marker</div> }));
vi.mock("./expense-categories-tab", () => ({
  ExpenseCategoriesTab: () => <div>expense-categories-tab-marker</div>,
}));
vi.mock("./quickbooks-tab", () => ({ QuickbooksTab: () => <div>quickbooks-tab-marker</div> }));
vi.mock("./stripe-tab", () => ({ StripeTab: () => <div>stripe-tab-marker</div> }));

import MoneySettingsPage from "./page";

describe("/settings/money shell", () => {
  it("renders the four expected tab labels in order", () => {
    render(<MoneySettingsPage />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Vendors",
      "Expense Categories",
      "QuickBooks",
      "Stripe",
    ]);
  });
});
