import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// #227 — smoke test for the combined /settings/jobs shell. The three tab
// bodies have their own behavior covered by the SettingsTabs unit tests
// and the (forthcoming) integration tests of each tab. This test only
// verifies that the shell wires up the three expected tabs in the right
// order and renders without crashing.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/jobs",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("./statuses-tab", () => ({ StatusesTab: () => <div>statuses-tab-marker</div> }));
vi.mock("./damage-types-tab", () => ({ DamageTypesTab: () => <div>damage-types-tab-marker</div> }));
vi.mock("./intake-form-tab", () => ({ IntakeFormTab: () => <div>intake-form-tab-marker</div> }));

import JobsSettingsPage from "./page";

describe("/settings/jobs shell", () => {
  it("renders the three expected tab labels in order", () => {
    render(<JobsSettingsPage />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Statuses",
      "Damage Types",
      "Intake Form",
    ]);
  });
});
