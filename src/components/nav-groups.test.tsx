// design-v2 step 2 (#912) — grouped sidebar nav per docs/design-system.md §5.
//
// The sidebar renders grouped navigation with eyebrow labels:
//   Jarvis (pinned top, no eyebrow)
//   Work: Dashboard, Jobs, Intake, Photos
//   Comms: Email, Phone, Contacts
//   Business: Accounting, Marketing, Referral Partners
//   Settings pinned bottom (with workspace + user)
//
// Context mocks mirror nav.test.tsx so the render rule is exercised in
// isolation.

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

const useAuthMock = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => useAuthMock(),
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

beforeEach(() => {
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

describe("Sidebar — grouped nav structure (#912, design-system §5)", () => {
  it("renders every item under its group in spec order — Jarvis first, Settings last", () => {
    render(<Sidebar />);

    // Eyebrow labels present.
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByText("Comms")).toBeTruthy();
    expect(screen.getByText("Business")).toBeTruthy();

    // Full link order pins the grouping: Jarvis pinned top (no eyebrow),
    // the three groups in §5 order, Settings pinned bottom.
    const hrefs = Array.from(document.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "/jarvis",
      "/",
      "/jobs",
      "/intake",
      "/photos",
      "/email",
      "/phone",
      "/contacts",
      "/accounting",
      "/marketing",
      "/referral-partners",
      "/settings",
    ]);
  });
});
