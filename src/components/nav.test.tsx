// PRD #304 — Nookleus Phone. Slice 2 (#306).
//
// Pins two AC bullets at the Sidebar render level:
//   1. The Phone item appears only when the caller holds `view_phone`.
//   2. When it appears, it sits between Contacts and Email.
//
// The Sidebar pulls from `navItems` (`src/lib/nav-items.ts`) and filters by
// the caller's role + permissions. This test mocks the contexts the Sidebar
// reads from so the filter rule can be exercised in isolation.

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
  // /api/settings/company fetch — return a non-ok response so the effect
  // sets no state and renders nothing for branding.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false } as Response)),
  );
});

function setAuth(opts: {
  role: string;
  grants: Record<string, boolean>;
}) {
  useAuthMock.mockReturnValue({
    user: { id: "u-1" },
    profile: { id: "u-1", full_name: "Test User", role: opts.role },
    permissions: opts.grants,
    loading: false,
    hasPermission: (key: string) => {
      if (opts.role === "admin") return true;
      return opts.grants[key] === true;
    },
    signOut: () => Promise.resolve(),
    refreshProfile: () => Promise.resolve(),
  });
}

describe("Sidebar — Phone item visibility (PRD #304 / #306)", () => {
  it("shows the Phone item to a crew_lead who holds view_phone", () => {
    setAuth({ role: "crew_lead", grants: { view_phone: true } });
    render(<Sidebar />);
    // Two renders (mobile bar + desktop sidebar) may produce two Phone
    // links; either way the item must be present.
    expect(screen.getAllByText("Phone").length).toBeGreaterThan(0);
  });

  it("shows the Phone item to an admin regardless of explicit grants", () => {
    setAuth({ role: "admin", grants: {} });
    render(<Sidebar />);
    expect(screen.getAllByText("Phone").length).toBeGreaterThan(0);
  });

  it("hides the Phone item from a crew_member without view_phone", () => {
    setAuth({ role: "crew_member", grants: { view_phone: false } });
    render(<Sidebar />);
    expect(screen.queryByText("Phone")).toBeNull();
  });

  it("positions the Phone item between Contacts and Email", () => {
    setAuth({ role: "crew_lead", grants: { view_phone: true } });
    render(<Sidebar />);
    const links = Array.from(document.querySelectorAll("a[href]"));
    const hrefs = links.map((a) => a.getAttribute("href"));
    const contactsIdx = hrefs.indexOf("/contacts");
    const phoneIdx = hrefs.indexOf("/phone");
    const emailIdx = hrefs.indexOf("/email");
    expect(contactsIdx).toBeGreaterThanOrEqual(0);
    expect(phoneIdx).toBeGreaterThan(contactsIdx);
    expect(emailIdx).toBeGreaterThan(phoneIdx);
  });
});
