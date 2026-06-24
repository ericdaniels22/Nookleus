// Slice 3 of the #681 add-then-reorder fix. The granular add flow POSTs a new
// line item (which bumps the parent's updated_at server-side) and then fires a
// reorder PUT to float it to the top. That PUT carries updated_at_snapshot; if
// it still holds the mount-time token it's STALE → 409 → the hook latches its
// stale-conflict guard and every later reorder short-circuits to false.
//
// adoptUpdatedAt is the seam: the builder hands the POST's fresh updated_at to
// the hook so the very next reorder PUT carries a non-stale snapshot.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useAutoSave } from "./use-auto-save";
import type { AutoSaveConfig } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));

type TestEntity = {
  id: string;
  updated_at?: string | null;
  title: string;
  sections: Array<{ items: Array<{ id: string }>; subsections: Array<{ items: Array<{ id: string }> }> }>;
};

function makeConfig(
  overrides: Partial<AutoSaveConfig<TestEntity>> = {},
): AutoSaveConfig<TestEntity> {
  return {
    entityKind: "estimate",
    entityId: "est-1",
    paths: {
      rootPut: "/api/estimates/est-1",
      sectionsReorder: "/api/estimates/est-1/sections/reorder",
      sectionRoute: (sectionId: string) => `/api/estimates/est-1/sections/${sectionId}`,
      lineItemsReorder: "/api/estimates/est-1/line-items/reorder",
      lineItemRoute: (itemId: string) => `/api/estimates/est-1/line-items/${itemId}`,
    },
    serializeRootPut: (e: TestEntity) => ({ title: e.title }),
    hasSnapshotConcurrency: true,
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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastReorderBody() {
  const call = fetchMock.mock.calls.find(
    ([path]) => path === "/api/estimates/est-1/line-items/reorder",
  );
  return JSON.parse((call?.[1] as RequestInit).body as string) as Record<string, unknown>;
}

describe("useAutoSave adoptUpdatedAt (#681)", () => {
  it("stamps the next reorder PUT with the adopted updated_at, not the mount-time token", async () => {
    const config = makeConfig();
    const { result } = renderHook(() =>
      useAutoSave(config, {
        entity: makeEntity({ updated_at: "2026-06-05T00:00:00Z" }),
        setEntity: () => {},
      }),
    );

    // The granular POST returned a fresher token after recalc bumped the row.
    act(() => {
      result.current.adoptUpdatedAt("2026-06-05T09:15:00Z");
    });

    await act(async () => {
      await result.current.saveLineItemsReorder([
        { id: "li-1", section_id: "sec-1", sort_order: 0 },
      ]);
    });

    expect(lastReorderBody().updated_at_snapshot).toBe("2026-06-05T09:15:00Z");
  });
});
