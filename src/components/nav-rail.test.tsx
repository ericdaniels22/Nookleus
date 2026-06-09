// Issue #543 — Estimate Builder full-width layout: slim nav rail.
//
// On a builder route the side navbar must render as a slim icon rail, and a
// single click expands/collapses it — WITHOUT mutating the persisted global
// collapse preference (localStorage "sidebar-collapsed"). The rail is driven
// by two new, optional Sidebar props:
//
//   forceCollapsed?: boolean   — overrides the persisted collapsed state for
//                                display while in the builder (ephemeral)
//   onToggleRail?: () => void  — the click handler used instead of the
//                                persisted context toggle, so no write happens
//
// These tests pin the rail behavior at the Sidebar render level, mirroring the
// context-mocking approach in nav.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/estimates/est-1/edit",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: () => null,
}));

const useAuthMock = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/lib/nav-order-context", () => ({
  useNavOrder: () => ({ order: new Map<string, number>() }),
}));

// The persisted-pref context toggle is a spy so a test can prove the rail
// toggle never reaches it.
const { toggleSpy } = vi.hoisted(() => ({ toggleSpy: vi.fn() }));
vi.mock("@/lib/sidebar-collapse-context", () => ({
  useSidebarCollapse: () => ({
    collapsed: false,
    toggle: toggleSpy,
    setCollapsed: () => {},
  }),
}));

vi.mock("@/components/notification-bell", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("@/components/workspace-switcher", () => ({
  __esModule: true,
  default: () => null,
}));

import Sidebar from "./nav";

beforeEach(() => {
  toggleSpy.mockReset();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({
    user: { id: "u-1" },
    profile: { id: "u-1", full_name: "Test User", role: "admin" },
    permissions: {},
    loading: false,
    hasPermission: () => true,
    signOut: () => Promise.resolve(),
    refreshProfile: () => Promise.resolve(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false } as Response)),
  );
});

describe("Sidebar — slim rail in the builder (#543)", () => {
  it("renders the slim rail when forceCollapsed, even though the persisted pref is expanded", () => {
    // Persisted pref is collapsed:false (expanded). forceCollapsed must win
    // for display, putting the rail in its collapsed/icon state — surfaced by
    // the "Expand sidebar" affordance that only exists when collapsed.
    render(<Sidebar forceCollapsed onToggleRail={() => {}} />);

    expect(screen.getByLabelText("Expand sidebar")).not.toBeNull();
  });

  it("routes the rail toggle click to onToggleRail, never the persisted context toggle", () => {
    const onToggleRail = vi.fn();
    render(<Sidebar forceCollapsed onToggleRail={onToggleRail} />);

    fireEvent.click(screen.getByLabelText("Expand sidebar"));

    expect(onToggleRail).toHaveBeenCalledTimes(1);
    expect(toggleSpy).not.toHaveBeenCalled();
  });
});

describe("Sidebar — persisted toggle unchanged outside the builder (#543)", () => {
  it("still toggles via the persisting context when no rail props are given", () => {
    // No forceCollapsed / onToggleRail → ordinary navbar. The persisted
    // context toggle must still fire (and persist) exactly as before.
    render(<Sidebar />);

    fireEvent.click(screen.getByLabelText("Collapse sidebar"));

    expect(toggleSpy).toHaveBeenCalledTimes(1);
  });
});
