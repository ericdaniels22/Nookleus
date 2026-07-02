// design-v2 step 2 (#912) — sidebar count chips per docs/design-system.md §5:
// "Count chips (e.g. unread) use the same tint style" as the active item
// (--sidebar-accent bg + --sidebar-accent-foreground), pill radius, 11–12px.
// The Email item shows its inbox unread count from /api/email/counts.
//
// Context mocks mirror nav.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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

/** Route the sidebar's fetches: email counts get the given payload, every
 *  other endpoint (company settings) fails quietly. */
function stubFetch(unread: number | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/email/counts") && unread !== null) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              inbox: { total: unread + 2, unread },
              sent: { total: 0, unread: 0 },
              categoryUnread: {},
            }),
        } as Response);
      }
      return Promise.resolve({ ok: false } as Response);
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("Sidebar — count chips (#912, design-system §5)", () => {
  it("shows the Email unread count as a tinted pill chip", async () => {
    stubFetch(7);
    render(<Sidebar />);

    const chip = await screen.findByText("7");
    // Same tint style as the active nav item, pill radius, 11px.
    expect(chip.className).toContain("bg-sidebar-accent");
    expect(chip.className).toContain("text-sidebar-accent-foreground");
    expect(chip.className).toContain("rounded-full");
    // The chip sits inside the Email link.
    expect(chip.closest("a")?.getAttribute("href")).toBe("/email");
  });

  it("renders no chip when there is nothing unread", async () => {
    stubFetch(0);
    render(<Sidebar />);

    // The Email item renders, chip-free.
    expect(await screen.findByText("Email")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("renders no chip when the counts endpoint is unavailable", async () => {
    // e.g. 403 for a member without view_email — the chip just stays hidden.
    stubFetch(null);
    render(<Sidebar />);

    expect(await screen.findByText("Email")).toBeTruthy();
    expect(
      document.querySelector("a[href='/email'] .rounded-full"),
    ).toBeNull();
  });
});
