// Issue #543 — Estimate Builder full-width layout: AppShell route wiring.
//
// AppShell is the chokepoint that decides, per route, whether the side navbar
// renders as the builder's slim rail or follows the persisted global pref.
// Its responsibilities, pinned here:
//
//   1. On a builder route it renders the Sidebar in rail mode (forceCollapsed)
//      with an ephemeral onToggleRail handler.
//   2. Toggling that rail flips the display but NEVER writes the persisted
//      "sidebar-collapsed" key (the crux acceptance criterion).
//   3. On a non-builder route it passes no rail props, so the persisted
//      preference drives the navbar exactly as before.
//
// The heavy Sidebar is replaced by a stand-in that records the props it
// receives and exposes the rail toggle. The persistence context is the REAL
// SidebarCollapseProvider, so the no-write guarantee is checked against the
// actual localStorage code, not a mock.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { pathnameRef } = vi.hoisted(() => ({
  pathnameRef: { current: "/" as string },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
}));

const { sidebarProps } = vi.hoisted(() => ({
  sidebarProps: {
    last: null as null | {
      forceCollapsed?: boolean;
      onToggleRail?: () => void;
    },
  },
}));
vi.mock("@/components/nav", () => ({
  __esModule: true,
  default: (props: { forceCollapsed?: boolean; onToggleRail?: () => void }) => {
    sidebarProps.last = props;
    return (
      <div data-testid="sidebar-stub">
        <button type="button" onClick={() => props.onToggleRail?.()}>
          rail-toggle
        </button>
      </div>
    );
  },
}));

// The On-the-clock chrome (added in #701) wraps the authed branch and calls
// useAuth(), which throws without an AuthProvider. These tests only exercise
// AppShell's route-to-chrome wiring, so the clock pieces are stubbed to inert
// passthroughs — keeping the harness focused on the sidebar/margin behavior.
vi.mock("@/lib/on-the-clock-context", () => ({
  OnTheClockProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/time/on-the-clock-bar", () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock("@/components/time/away-nudge-watcher", () => ({
  __esModule: true,
  default: () => null,
}));

import AppShell from "./app-shell";
import { SidebarCollapseProvider } from "@/lib/sidebar-collapse-context";

// The real SidebarCollapseProvider reads/writes window.localStorage on mount.
// Under Node's experimental localStorage the global is a bare object missing
// getItem/setItem, so we install a functional in-memory fake the provider can
// drive. Later tracers upgrade setItem to a spy to prove the rail never writes.
const store = new Map<string, string>();
let setItemSpy: ReturnType<typeof vi.fn>;
function installLocalStorage() {
  store.clear();
  setItemSpy = vi.fn((k: string, v: string) => {
    store.set(k, String(v));
  });
  const fake = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: setItemSpy,
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: fake,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installLocalStorage();
  sidebarProps.last = null;
  pathnameRef.current = "/";
});

function renderShell() {
  return render(
    <SidebarCollapseProvider>
      <AppShell>
        <div>page content</div>
      </AppShell>
    </SidebarCollapseProvider>,
  );
}

describe("AppShell — slim rail on builder routes (#543)", () => {
  it("renders the sidebar in rail mode on a builder route", () => {
    pathnameRef.current = "/estimates/est-1/edit";
    renderShell();

    expect(sidebarProps.last?.forceCollapsed).toBe(true);
    expect(typeof sidebarProps.last?.onToggleRail).toBe("function");
  });

  it("expands and collapses the rail on click without writing the persisted pref", () => {
    // Acceptance crux: one click expands the rail (forceCollapsed flips to
    // false) and a second collapses it — but the global "sidebar-collapsed"
    // preference must NEVER be written while in the builder.
    pathnameRef.current = "/estimates/est-1/edit";
    renderShell();

    expect(sidebarProps.last?.forceCollapsed).toBe(true);

    fireEvent.click(screen.getByText("rail-toggle"));
    expect(sidebarProps.last?.forceCollapsed).toBe(false);

    fireEvent.click(screen.getByText("rail-toggle"));
    expect(sidebarProps.last?.forceCollapsed).toBe(true);

    const wrotePref = setItemSpy.mock.calls.some(
      ([key]) => key === "sidebar-collapsed",
    );
    expect(wrotePref).toBe(false);
  });
});

describe("AppShell — persisted navbar unchanged off builder routes (#543)", () => {
  it("passes no rail props on a non-builder route", () => {
    // Off the builder, the navbar must behave exactly as before: the persisted
    // global pref drives it, so AppShell forwards neither rail override.
    pathnameRef.current = "/estimates";
    renderShell();

    expect(sidebarProps.last?.forceCollapsed).toBeUndefined();
    expect(sidebarProps.last?.onToggleRail).toBeUndefined();
  });
});

describe("AppShell — Photo Report builder is a builder route (#548)", () => {
  it("renders the app navigation in rail mode on the report builder route", () => {
    // The in-Job Photo Report builder used to be in INTERNAL_FULLSCREEN_PATTERNS
    // (nav stripped — a dead-end). #548 restores the nav: the route is now a
    // builder route, so the Sidebar renders as the slim rail, collapsed by
    // default, with the ephemeral toggle.
    pathnameRef.current = "/jobs/job-1/reports/report-1";
    renderShell();

    expect(sidebarProps.last?.forceCollapsed).toBe(true);
    expect(typeof sidebarProps.last?.onToggleRail).toBe("function");
  });

  it("toggles the rail on the report route without writing the persisted pref", () => {
    // Same crux as #543, pinned against this route: expanding the rail while
    // authoring a report must never write "sidebar-collapsed" — leaving the
    // builder restores whatever navbar state the user had.
    pathnameRef.current = "/jobs/job-1/reports/report-1";
    renderShell();

    fireEvent.click(screen.getByText("rail-toggle"));
    expect(sidebarProps.last?.forceCollapsed).toBe(false);

    const wrotePref = setItemSpy.mock.calls.some(
      ([key]) => key === "sidebar-collapsed",
    );
    expect(wrotePref).toBe(false);
  });
});

describe("AppShell — public marketing & legal routes render bare (#789 OAuth verification)", () => {
  // The OAuth app-verification follow-up needs publicly reachable marketing
  // and legal pages on nookleus.app (Google reviewers can't log in). Those
  // routes must render WITHOUT the internal app chrome — no sidebar, no
  // authed <main> wrapper — exactly like the existing /sign and /pay surfaces.
  it.each(["/welcome", "/privacy", "/terms"])(
    "renders %s without the app sidebar or main chrome",
    (path) => {
      pathnameRef.current = path;
      renderShell();

      expect(screen.queryByTestId("sidebar-stub")).toBeNull();
      expect(screen.queryByRole("main")).toBeNull();
      // The page content itself still renders.
      expect(screen.getByText("page content")).toBeTruthy();
    },
  );
});

describe("AppShell — content margin tracks the rail (#543 / #912)", () => {
  it("reserves the slim-rail margin on a builder route and widens when expanded", () => {
    // The document must sit beside the slim rail (narrow left margin) even
    // though the persisted pref is expanded — then follow the rail as it
    // opens. Rail is 56px from md up (§7.1); the full sidebar is 240px at lg.
    pathnameRef.current = "/estimates/est-1/edit";
    renderShell();

    const main = screen.getByRole("main");
    expect(main.className).toContain("md:ml-14");
    expect(main.className).not.toContain("lg:ml-60");

    fireEvent.click(screen.getByText("rail-toggle"));
    expect(main.className).toContain("lg:ml-60");
  });
});

describe("AppShell — responsive shell bands (#912, design-system §4/§7)", () => {
  it("clears the icon rail from md and the full 240px sidebar from lg", () => {
    // §7.1: drawer < 640 (no margin — the topbar offsets via padding), icon
    // rail 56px at md, full sidebar 240px at lg. The expanded margin scheme
    // must carry both responsive steps.
    pathnameRef.current = "/";
    renderShell();

    const main = screen.getByRole("main");
    expect(main.className).toContain("md:ml-14");
    expect(main.className).toContain("lg:ml-60");
    // The mobile topbar disappears at md (the rail takes over), so the
    // topbar height offset must clear at md, not lg.
    expect(main.className).toContain("md:pt-0");
  });

  it("caps content at 1440px with 16px phone padding stepping up per band", () => {
    // §4: main content max-width 1440px, fluid below. Page padding 16px
    // mobile (p-4), 24–32px desktop (md:p-6 lg:p-8).
    pathnameRef.current = "/";
    renderShell();

    const content = screen.getByText("page content").parentElement!;
    expect(content.className).toContain("max-w-[1440px]");
    expect(content.className).toContain("mx-auto");
    expect(content.className).toContain("p-4");
    expect(content.className).toContain("md:p-6");
    expect(content.className).toContain("lg:p-8");
  });
});

describe("AppShell — Sketch builder renders full-bleed beside the rail (#859)", () => {
  it("keeps the slim rail but hangs the sketch directly off <main>, outside the §4 content box", () => {
    // The plan editor is a viewport-owning canvas surface (like /email): its
    // root must resolve its own height against the viewport. The §4 wrapper is
    // auto-height, so interposing it snaps the editor's percentage-height
    // chain — the flex-1 canvas body collapses to 0px and Fabric gets a
    // 0-height backing store (#859: drawing a Room from scratch was
    // impossible on every deploy of #890).
    pathnameRef.current = "/jobs/job-1/sketch";
    renderShell();

    // Still a builder route: slim rail with the ephemeral toggle (#890).
    expect(sidebarProps.last?.forceCollapsed).toBe(true);
    expect(typeof sidebarProps.last?.onToggleRail).toBe("function");

    // Full-bleed: the page content is a direct child of <main> — no width cap,
    // no page padding, no auto-height wrapper between the viewport and the
    // editor.
    const content = screen.getByText("page content");
    expect(content.parentElement).toBe(screen.getByRole("main"));
  });
});
