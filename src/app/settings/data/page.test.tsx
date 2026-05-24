import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// #231 — smoke test for the combined /settings/data shell. The two tab
// bodies have their own behavior covered by their pre-extraction tests
// (and by API-route tests). This test only verifies that the shell wires
// up the two expected tabs in the right order and renders without crashing.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/data",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("./export-tab", () => ({
  ExportTab: () => <div>export-tab-marker</div>,
}));
vi.mock("./knowledge-base-tab", () => ({
  KnowledgeBaseTab: () => <div>knowledge-base-tab-marker</div>,
}));

import DataSettingsPage from "./page";

describe("/settings/data shell", () => {
  it("renders the two expected tab labels in order", () => {
    render(<DataSettingsPage />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Export",
      "Knowledge Base",
    ]);
  });
});
