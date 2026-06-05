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

// Issue #406 / ADR 0009 — the standalone global Reports area (the /reports
// list, the /reports/new wizard, /reports/[id], and /reports/templates) was
// removed; Photo Reports are reached only through their Job now. The removal
// itself shipped incrementally with #400 and #405; these tests are the
// regression guard that pins it at the Sidebar render level so the item — and
// any link into the old global area — cannot silently come back.
//
// Admin is used deliberately: an admin sees every gated nav item, so a
// re-added Reports entry could not hide behind a role/permission gate.
describe("Sidebar — no standalone global Reports area (#406 / ADR 0009)", () => {
  it("renders no link into the removed global /reports area", () => {
    setAuth({ role: "admin", grants: {} });
    render(<Sidebar />);
    const hrefs = Array.from(document.querySelectorAll("a[href]")).map(
      (a) => a.getAttribute("href") ?? "",
    );
    // A standalone "/reports" or "/reports/<anything>" href is the removed
    // global area. In-Job reports live under /jobs/<id>/reports/... and
    // Settings links never start with "/reports", so this anchored match
    // flags only a genuine regression, not the retained in-Job flow.
    const globalReportsLinks = hrefs.filter((h) => /^\/reports(\/|$)/.test(h));
    expect(globalReportsLinks).toEqual([]);
  });

  it("shows no Reports nav item label", () => {
    setAuth({ role: "admin", grants: {} });
    render(<Sidebar />);
    // The Sidebar renders both the mobile bar and the desktop aside, so a
    // re-added item could appear more than once — assert zero occurrences.
    expect(screen.queryAllByText("Reports")).toHaveLength(0);
    expect(screen.queryAllByText("Report Templates")).toHaveLength(0);
  });
});
