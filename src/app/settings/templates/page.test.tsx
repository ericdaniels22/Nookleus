import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// #232 — smoke test for the combined /settings/templates shell. Each tab
// body has its own behavior covered elsewhere; this test only verifies
// that the shell wires up the five expected tabs in the right order and
// renders without crashing.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/templates",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("./estimates-tab", () => ({
  EstimatesTab: () => <div>estimates-tab-marker</div>,
}));
vi.mock("./contracts-tab", () => ({
  ContractsTab: () => <div>contracts-tab-marker</div>,
}));
vi.mock("./item-library-tab", () => ({
  ItemLibraryTab: () => <div>item-library-tab-marker</div>,
}));
vi.mock("./photo-report-defaults-tab", () => ({
  PhotoReportDefaultsTab: () => <div>photo-report-defaults-tab-marker</div>,
}));
vi.mock("./photo-report-templates-tab", () => ({
  PhotoReportTemplatesTab: () => <div>photo-report-templates-tab-marker</div>,
}));

import TemplatesSettingsPage from "./page";

describe("/settings/templates shell", () => {
  it("renders the five expected tab labels in order", () => {
    render(<TemplatesSettingsPage />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Estimates",
      "Contracts",
      "Item Library",
      "Photo Report Templates",
      "Photo Report Defaults",
    ]);
  });
});
