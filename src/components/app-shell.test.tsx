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

describe("AppShell — content margin tracks the rail (#543)", () => {
  it("reserves the slim-rail margin on a builder route and widens when expanded", () => {
    // The document must sit beside the slim rail (narrow left margin) even
    // though the persisted pref is expanded — then follow the rail as it opens.
    pathnameRef.current = "/estimates/est-1/edit";
    renderShell();

    const main = screen.getByRole("main");
    expect(main.className).toContain("lg:ml-16");
    expect(main.className).not.toContain("lg:ml-52");

    fireEvent.click(screen.getByText("rail-toggle"));
    expect(main.className).toContain("lg:ml-52");
    expect(main.className).not.toContain("lg:ml-16");
  });
});
