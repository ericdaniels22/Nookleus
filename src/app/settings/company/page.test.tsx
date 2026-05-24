import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// #233 — smoke test for the combined /settings/company shell. The two tab
// bodies have their own behavior covered by the original page tests that
// were extracted here unchanged. This test only verifies that the shell
// wires up the two expected tabs in the right order (Profile first as
// default) and renders without crashing.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/company",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("./profile-tab", () => ({ ProfileTab: () => <div>profile-tab-marker</div> }));
vi.mock("./branding-tab", () => ({ BrandingTab: () => <div>branding-tab-marker</div> }));

import CompanySettingsPage from "./page";

describe("/settings/company shell", () => {
  it("renders the two expected tab labels in order", () => {
    render(<CompanySettingsPage />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Profile", "Branding"]);
  });
});
