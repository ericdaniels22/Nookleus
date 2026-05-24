import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// #229 — smoke test for the combined /settings/email shell. The two tab
// bodies (Accounts, Signatures) keep their own behavior covered by their
// co-located tests; this test only verifies that the shell wires up the
// two expected tabs in the right order and renders without crashing.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/email",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("./accounts-tab", () => ({ AccountsTab: () => <div>accounts-tab-marker</div> }));
vi.mock("./signatures-tab", () => ({ SignaturesTab: () => <div>signatures-tab-marker</div> }));

import EmailSettingsPage from "./page";

describe("/settings/email shell", () => {
  it("renders the two expected tab labels in order", () => {
    render(<EmailSettingsPage />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Accounts", "Signatures"]);
  });

  it("renders the Accounts tab by default", () => {
    render(<EmailSettingsPage />);

    expect(screen.getByText("accounts-tab-marker")).toBeDefined();
  });
});
