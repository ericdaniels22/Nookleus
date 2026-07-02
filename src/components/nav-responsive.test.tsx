// design-v2 step 2 (#912) — responsive sidebar bands per docs/design-system.md
// §7.1: below md the sidebar is a drawer, at md (iPad portrait) it is a 56px
// icon rail regardless of the persisted collapse pref, at lg+ the persisted
// pref drives it. jsdom has no matchMedia, so the desktop band is the
// default — these tests stub matchMedia to simulate the tablet band.
//
// Context mocks mirror nav.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "u-1" },
    profile: { id: "u-1", full_name: "Test User", role: "admin" },
    permissions: {},
    loading: false,
    hasPermission: () => true,
    signOut: () => Promise.resolve(),
    refreshProfile: () => Promise.resolve(),
  }),
}));

vi.mock("@/lib/nav-order-context", () => ({
  useNavOrder: () => ({ order: new Map<string, number>() }),
}));

// The persisted pref says EXPANDED — the tablet band must override it.
vi.mock("@/lib/sidebar-collapse-context", () => ({
  useSidebarCollapse: () => ({ collapsed: false, toggle: () => {} }),
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

/** Simulate a viewport band by answering the two min-width queries the
 *  viewport-band hook asks. Tablet = ≥768 but not ≥1024. */
function stubBand({ tablet, desktop }: { tablet: boolean; desktop: boolean }) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("1024") ? desktop : tablet,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false } as Response)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Sidebar — icon rail at the tablet band (#912, design-system §7.1)", () => {
  it("renders icon-only links at iPad portrait even when the pref is expanded", () => {
    stubBand({ tablet: true, desktop: false });
    render(<Sidebar />);

    // Rail mode: no visible label text, no eyebrow labels …
    expect(screen.queryByText("Dashboard")).toBeNull();
    expect(screen.queryByText("Work")).toBeNull();

    // … but every item keeps its accessible name on the icon link.
    expect(
      screen.getAllByLabelText("Dashboard").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByLabelText("Settings").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("keeps the full labeled sidebar at the desktop band", () => {
    stubBand({ tablet: true, desktop: true });
    render(<Sidebar />);

    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.getByText("Work")).toBeTruthy();
  });

  it("expands the rail into the labeled overlay on tap — the touch equivalent (§7.2)", () => {
    // Tooltips only serve hover/long-press; the rail's expand button must
    // open the full labeled sidebar as an overlay so nothing is
    // hover-only on the iPad.
    stubBand({ tablet: true, desktop: false });
    render(<Sidebar />);

    expect(screen.queryByText("Dashboard")).toBeNull();

    fireEvent.click(screen.getByLabelText("Expand sidebar"));
    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.getByText("Work")).toBeTruthy();

    // The collapse affordance returns to the rail without touching the
    // persisted pref (the context toggle here is a no-op mock, so a pass
    // proves the overlay state drove the change).
    fireEvent.click(screen.getByLabelText("Collapse sidebar"));
    expect(screen.queryByText("Dashboard")).toBeNull();
  });
});
