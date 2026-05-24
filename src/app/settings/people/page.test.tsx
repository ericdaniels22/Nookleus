import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// #228 — smoke test for the combined /settings/people shell. The two tab
// bodies have their own behavior covered by the extracted page tests; this
// test only verifies that the shell wires up the two expected tabs in the
// right order and renders without crashing.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/people",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("./users-crew-tab", () => ({ UsersCrewTab: () => <div>users-crew-tab-marker</div> }));
vi.mock("./notifications-tab", () => ({ NotificationsTab: () => <div>notifications-tab-marker</div> }));

import PeopleSettingsPage from "./page";

describe("/settings/people shell", () => {
  it("renders the two expected tab labels in order", () => {
    render(<PeopleSettingsPage />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Users & Crew",
      "Notifications",
    ]);
  });
});
