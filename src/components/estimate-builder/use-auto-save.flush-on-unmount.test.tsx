// Integration tests for useAutoSave's flush-on-unmount (issue #461). Mounts a
// minimal harness around the REAL hook, edits within the debounce window, then
// unmounts — asserting the pending edit is flushed via a keepalive PUT instead
// of being silently dropped. Mirrors the #443 photo-report unmount tests
// (render + fake timers + mocked transport); here the transport is `fetch`.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";

import { useAutoSave } from "./use-auto-save";
import type { AutoSaveConfig } from "@/lib/types";

// toast.error fires on the 409 stale-conflict path; stub sonner so it's inert.
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));

// ── Fixtures (shared shape with use-auto-save.plan-unmount-flush.test.ts) ─────

type TestItem = { id: string } & Record<string, unknown>;

interface TestEntity {
  id: string;
  updated_at?: string | null;
  title: string;
  sections: Array<{
    items: TestItem[];
    subsections: Array<{ items: TestItem[] }>;
  }>;
}

function makeConfig(
  overrides: Partial<AutoSaveConfig<TestEntity>> = {},
): AutoSaveConfig<TestEntity> {
  return {
    entityKind: "estimate",
    entityId: "est-1",
    paths: {
      rootPut: "/api/estimates/est-1",
      sectionsReorder: "/api/estimates/est-1/sections/reorder",
      sectionRoute: (sectionId: string) =>
        `/api/estimates/est-1/sections/${sectionId}`,
      lineItemsReorder: "/api/estimates/est-1/line-items/reorder",
      lineItemRoute: (itemId: string) =>
        `/api/estimates/est-1/line-items/${itemId}`,
    },
    serializeRootPut: (e: TestEntity) => ({ title: e.title }),
    hasSnapshotConcurrency: true,
    ...overrides,
  };
}

function makeItem(id: string, overrides: Record<string, unknown> = {}): TestItem {
  return {
    id,
    description: "Replace shingles",
    note: null,
    code: null,
    quantity: 1,
    unit: "sq",
    unit_price: 100,
    section_id: "sec-1",
    sort_order: 0,
    ...overrides,
  };
}

function makeEntity(overrides: Partial<TestEntity> = {}): TestEntity {
  return {
    id: "est-1",
    updated_at: "2026-06-05T00:00:00Z",
    title: "Roof repair",
    sections: [],
    ...overrides,
  };
}

// Minimal harness: drives the real hook off an `entity` prop. Re-rendering with
// a new entity simulates an in-app edit; unmounting simulates navigating away.
function Harness({
  config,
  entity,
}: {
  config: AutoSaveConfig<TestEntity>;
  entity: TestEntity;
}) {
  useAutoSave(config, { entity, setEntity: () => {} });
  return null;
}

// Only the PUTs the unmount flush fired carry keepalive: true — isolate them so
// an assertion can't be fooled by an unrelated debounced/in-flight save.
function keepalivePuts(mock: ReturnType<typeof vi.fn>): unknown[][] {
  return mock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.keepalive === true,
  );
}

// jsdom's document.visibilityState is a read-only getter; override it so a
// visibilitychange event can simulate the page being backgrounded/hidden.
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setVisibility("visible"); // reset so a hidden value can't leak to the next test
});

describe("useAutoSave flush-on-unmount (#461)", () => {
  it("flushes a dirty entity-level edit as a keepalive PUT to rootPut on unmount", () => {
    const config = makeConfig();
    const { rerender, unmount } = render(
      <Harness config={config} entity={makeEntity({ title: "Roof repair" })} />,
    );

    // Edit a root field, but stay inside the 2s debounce window (no timer flush).
    rerender(
      <Harness
        config={config}
        entity={makeEntity({ title: "Roof repair — edited" })}
      />,
    );

    // Navigate away.
    act(() => {
      unmount();
    });

    const puts = keepalivePuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe("/api/estimates/est-1");
    const init = puts[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({
      title: "Roof repair — edited",
    });
  });

  it("fires no PUT when the entity is unmounted untouched", () => {
    const config = makeConfig();
    const { unmount } = render(
      <Harness config={config} entity={makeEntity({ title: "Roof repair" })} />,
    );

    // No edit — just navigate away.
    act(() => {
      unmount();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flushes a dirty line item as a keepalive PUT to its line-item route on unmount", () => {
    const config = makeConfig();
    const section = (description: string) => ({
      items: [makeItem("li-1", { description })],
      subsections: [],
    });

    const { rerender, unmount } = render(
      <Harness
        config={config}
        entity={makeEntity({ sections: [section("Replace shingles")] })}
      />,
    );

    // Edit the line item, staying inside the debounce window.
    rerender(
      <Harness
        config={config}
        entity={makeEntity({ sections: [section("Replace shingles — 30yr")] })}
      />,
    );

    act(() => {
      unmount();
    });

    const puts = keepalivePuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe("/api/estimates/est-1/line-items/li-1");
    const init = puts[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({
      description: "Replace shingles — 30yr",
    });
  });

  it("stamps the flushed body with updated_at_snapshot when concurrency is enabled", () => {
    const config = makeConfig({ hasSnapshotConcurrency: true });
    const { rerender, unmount } = render(
      <Harness
        config={config}
        entity={makeEntity({
          title: "Roof repair",
          updated_at: "2026-06-05T12:30:00Z",
        })}
      />,
    );

    rerender(
      <Harness
        config={config}
        entity={makeEntity({
          title: "Roof repair — edited",
          updated_at: "2026-06-05T12:30:00Z",
        })}
      />,
    );

    act(() => {
      unmount();
    });

    const puts = keepalivePuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(JSON.parse((puts[0][1] as RequestInit).body as string)).toMatchObject({
      title: "Roof repair — edited",
      updated_at_snapshot: "2026-06-05T12:30:00Z",
    });
  });

  it("omits updated_at_snapshot from the flushed body when concurrency is disabled", () => {
    const config = makeConfig({ hasSnapshotConcurrency: false });
    const { rerender, unmount } = render(
      <Harness config={config} entity={makeEntity({ title: "Roof repair" })} />,
    );

    rerender(
      <Harness
        config={config}
        entity={makeEntity({ title: "Roof repair — edited" })}
      />,
    );

    act(() => {
      unmount();
    });

    const puts = keepalivePuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(JSON.parse((puts[0][1] as RequestInit).body as string)).not.toHaveProperty(
      "updated_at_snapshot",
    );
  });

  it("suppresses the unmount flush entirely while a stale conflict is active", async () => {
    const config = makeConfig({ hasSnapshotConcurrency: true });
    // The debounced save will 409 (another user modified the row), driving the
    // hook into its stale-conflict state.
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 409, json: async () => ({}) } as Response),
    );

    const { rerender, unmount } = render(
      <Harness config={config} entity={makeEntity({ title: "Roof repair" })} />,
    );

    rerender(
      <Harness
        config={config}
        entity={makeEntity({ title: "Roof repair — edited" })}
      />,
    );

    // Let the debounced save fire and 409 → hook enters stale-conflict.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // The 409 PUT happened (debounced, not keepalive); reaching here proves the
    // hook is genuinely in stale-conflict, so the flush has something to suppress.
    expect(fetchMock).toHaveBeenCalled();
    expect(keepalivePuts(fetchMock)).toHaveLength(0);

    act(() => {
      unmount();
    });

    // Still dirty, but the active stale conflict must block any flush PUT.
    expect(keepalivePuts(fetchMock)).toHaveLength(0);
  });

  it("flushes a template's root edit but never a per-line-item PUT", () => {
    const config = makeConfig({
      entityKind: "template",
      hasSnapshotConcurrency: false,
    });
    const templateEntity = (title: string, description: string) =>
      makeEntity({
        title,
        sections: [{ items: [makeItem("li-1", { description })], subsections: [] }],
      });

    const { rerender, unmount } = render(
      <Harness
        config={config}
        entity={templateEntity("Roof template", "Replace shingles")}
      />,
    );

    // Both the root AND the line item are dirty on unmount.
    rerender(
      <Harness
        config={config}
        entity={templateEntity("Roof template — edited", "Replace shingles — edited")}
      />,
    );

    act(() => {
      unmount();
    });

    const puts = keepalivePuts(fetchMock);
    // Exactly the root PUT — the dirty line item is gated off for templates.
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe("/api/estimates/est-1");
    expect(puts.some(([path]) => String(path).includes("/line-items/"))).toBe(false);
  });
});

// Hard unload (#477): a real tab-close / refresh / address-bar nav does NOT run
// React cleanup, so the unmount flush above never fires. These tests keep the
// component MOUNTED and dispatch the browser page-lifecycle events the hook now
// listens for — proving the flush is driven by the listeners, not by unmount.
describe("useAutoSave flush-on-hard-unload (#477)", () => {
  it("flushes a dirty root edit as a keepalive PUT on a pagehide event (still mounted)", () => {
    const config = makeConfig();
    const { rerender, unmount } = render(
      <Harness config={config} entity={makeEntity({ title: "Roof repair" })} />,
    );

    // Edit a root field, staying inside the 2s debounce window (no timer flush).
    rerender(
      <Harness
        config={config}
        entity={makeEntity({ title: "Roof repair — edited" })}
      />,
    );

    // The page is torn down the hard way — React cleanup never runs.
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    const puts = keepalivePuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe("/api/estimates/est-1");
    const init = puts[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({
      title: "Roof repair — edited",
    });

    // Tidy up while fetch is still stubbed (the test left the node mounted).
    act(() => {
      unmount();
    });
  });

  it("flushes a dirty root edit as a keepalive PUT on visibilitychange when the page becomes hidden", () => {
    const config = makeConfig();
    const { rerender, unmount } = render(
      <Harness config={config} entity={makeEntity({ title: "Roof repair" })} />,
    );

    rerender(
      <Harness
        config={config}
        entity={makeEntity({ title: "Roof repair — edited" })}
      />,
    );

    // The tab/app is backgrounded — the common iOS exit path.
    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    const puts = keepalivePuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe("/api/estimates/est-1");
    const init = puts[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({
      title: "Roof repair — edited",
    });

    act(() => {
      unmount();
    });
  });

  it("does not flush on visibilitychange when the page becomes visible", () => {
    const config = makeConfig();
    const { rerender, unmount } = render(
      <Harness config={config} entity={makeEntity({ title: "Roof repair" })} />,
    );

    rerender(
      <Harness
        config={config}
        entity={makeEntity({ title: "Roof repair — edited" })}
      />,
    );

    // Returning to the foreground is not a teardown — no flush.
    act(() => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(keepalivePuts(fetchMock)).toHaveLength(0);

    act(() => {
      unmount();
    });
  });

  it("fires no PUT on pagehide or visibilitychange when the document is clean", () => {
    const config = makeConfig();
    const { unmount } = render(
      <Harness config={config} entity={makeEntity({ title: "Roof repair" })} />,
    );

    // No edit — both events should be no-ops (the planner returns an empty plan).
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });
  });

  it("suppresses the pagehide flush entirely while a stale conflict is active", async () => {
    const config = makeConfig({ hasSnapshotConcurrency: true });
    // The debounced save will 409 (another user modified the row), driving the
    // hook into its stale-conflict state.
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 409, json: async () => ({}) } as Response),
    );

    const { rerender, unmount } = render(
      <Harness config={config} entity={makeEntity({ title: "Roof repair" })} />,
    );

    rerender(
      <Harness
        config={config}
        entity={makeEntity({ title: "Roof repair — edited" })}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(keepalivePuts(fetchMock)).toHaveLength(0);

    // Hard unload while the conflict is active: the planner still suppresses.
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(keepalivePuts(fetchMock)).toHaveLength(0);

    act(() => {
      unmount();
    });
  });

  it("removes its listeners on unmount — a later pagehide or visibilitychange fires no further PUT", () => {
    const config = makeConfig();
    const { rerender, unmount } = render(
      <Harness config={config} entity={makeEntity({ title: "Roof repair" })} />,
    );

    rerender(
      <Harness
        config={config}
        entity={makeEntity({ title: "Roof repair — edited" })}
      />,
    );

    // In-app unmount flushes once via the #461 cleanup.
    act(() => {
      unmount();
    });
    const afterUnmount = keepalivePuts(fetchMock).length;
    expect(afterUnmount).toBe(1);

    // The listeners must be gone: were they leaked, this would fire a 2nd PUT
    // (the entity is still dirty relative to the un-advanced snapshot).
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(keepalivePuts(fetchMock)).toHaveLength(afterUnmount);
  });

  it("flushes a template's root edit but never a per-line-item PUT on pagehide", () => {
    const config = makeConfig({
      entityKind: "template",
      hasSnapshotConcurrency: false,
    });
    const templateEntity = (title: string, description: string) =>
      makeEntity({
        title,
        sections: [{ items: [makeItem("li-1", { description })], subsections: [] }],
      });

    const { rerender, unmount } = render(
      <Harness
        config={config}
        entity={templateEntity("Roof template", "Replace shingles")}
      />,
    );

    // Both the root AND the line item are dirty.
    rerender(
      <Harness
        config={config}
        entity={templateEntity("Roof template — edited", "Replace shingles — edited")}
      />,
    );

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    const puts = keepalivePuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe("/api/estimates/est-1");
    expect(puts.some(([path]) => String(path).includes("/line-items/"))).toBe(false);

    act(() => {
      unmount();
    });
  });

  it("stamps updated_at_snapshot on the pagehide flush when concurrency is enabled", () => {
    const config = makeConfig({ hasSnapshotConcurrency: true });
    const { rerender, unmount } = render(
      <Harness
        config={config}
        entity={makeEntity({
          title: "Roof repair",
          updated_at: "2026-06-05T12:30:00Z",
        })}
      />,
    );

    rerender(
      <Harness
        config={config}
        entity={makeEntity({
          title: "Roof repair — edited",
          updated_at: "2026-06-05T12:30:00Z",
        })}
      />,
    );

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    const puts = keepalivePuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(JSON.parse((puts[0][1] as RequestInit).body as string)).toMatchObject({
      title: "Roof repair — edited",
      updated_at_snapshot: "2026-06-05T12:30:00Z",
    });

    act(() => {
      unmount();
    });
  });
});
