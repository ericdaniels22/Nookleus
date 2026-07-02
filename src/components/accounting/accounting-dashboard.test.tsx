import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

// The tab panels each fetch on mount; stub them out so the dashboard renders in
// isolation. We only care about the tab-strip styling here.
vi.mock("./stat-cards", () => ({ default: () => null }));
vi.mock("./job-profitability-tab", () => ({ default: () => null }));
vi.mock("./ar-aging-tab", () => ({ default: () => null }));
vi.mock("./global-expenses-tab", () => ({ default: () => null }));
vi.mock("./by-damage-type-tab", () => ({ default: () => null }));
vi.mock("./qb-sync-tab", () => ({ default: () => null }));
vi.mock("./qb-expired-banner", () => ({ default: () => null }));
vi.mock("./date-range-selector", () => ({ default: () => null }));
vi.mock("./export-menu", () => ({ default: () => null }));

import AccountingDashboard from "./accounting-dashboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<AccountingDashboard> §2.4 active tab", () => {
  it("underlines the active tab with the product-accent token, not an inline hex", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );

    const { getByRole } = render(<AccountingDashboard />);
    // "profitability" is the default active tab.
    const active = getByRole("button", { name: "Job profitability" });

    expect(active.className).toContain("border-primary");
    expect(active.getAttribute("style")).toBeFalsy();
  });
});
