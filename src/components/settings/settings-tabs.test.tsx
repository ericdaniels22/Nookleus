import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// #227 — SettingsTabs is the URL-synced tab shell every combined Settings
// section uses. The Settings sidebar is the user's outer navigation; tabs
// inside a section are the inner one. URL sync (`?tab=<key>`) makes inner
// tabs linkable and back-button friendly. These tests pin the behaviors
// that callers depend on; they don't care which tab primitive is used
// underneath.

const navState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replaceCalls: [] as string[],
  pushCalls: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navState.searchParams,
  usePathname: () => "/settings/jobs",
  useRouter: () => ({
    replace: (url: string) => navState.replaceCalls.push(url),
    push: (url: string) => navState.pushCalls.push(url),
  }),
}));

import { SettingsTabs } from "./settings-tabs";

const tabs = [
  { key: "statuses", label: "Statuses", content: <div>Statuses body</div> },
  { key: "damage-types", label: "Damage Types", content: <div>Damage body</div> },
  { key: "intake-form", label: "Intake Form", content: <div>Intake body</div> },
];

beforeEach(() => {
  navState.searchParams = new URLSearchParams();
  navState.replaceCalls = [];
  navState.pushCalls = [];
});

describe("SettingsTabs", () => {
  it("renders the first tab as active when no ?tab= is present and no defaultTab is given", () => {
    render(<SettingsTabs tabs={tabs} />);

    // First tab's content is shown; others are not.
    expect(screen.getByText("Statuses body")).toBeDefined();
    expect(screen.queryByText("Damage body")).toBeNull();
    expect(screen.queryByText("Intake body")).toBeNull();
  });

  it("uses defaultTab when no ?tab= is present", () => {
    render(<SettingsTabs tabs={tabs} defaultTab="damage-types" />);

    expect(screen.getByText("Damage body")).toBeDefined();
    expect(screen.queryByText("Statuses body")).toBeNull();
  });

  it("reads the active tab from ?tab=, overriding defaultTab", () => {
    navState.searchParams = new URLSearchParams("tab=intake-form");

    render(<SettingsTabs tabs={tabs} defaultTab="damage-types" />);

    expect(screen.getByText("Intake body")).toBeDefined();
    expect(screen.queryByText("Damage body")).toBeNull();
  });

  it("falls back to defaultTab when ?tab= names an unknown key", () => {
    navState.searchParams = new URLSearchParams("tab=not-a-real-tab");

    render(<SettingsTabs tabs={tabs} defaultTab="damage-types" />);

    expect(screen.getByText("Damage body")).toBeDefined();
    expect(screen.queryByText("Statuses body")).toBeNull();
  });

  it("updates the URL via router.replace when a tab is clicked", () => {
    render(<SettingsTabs tabs={tabs} />);

    fireEvent.click(screen.getByRole("tab", { name: "Damage Types" }));

    expect(navState.replaceCalls).toContain("/settings/jobs?tab=damage-types");
    expect(navState.pushCalls).toEqual([]);
  });
});
