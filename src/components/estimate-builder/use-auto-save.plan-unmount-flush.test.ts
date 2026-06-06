// Guards planUnmountFlush (#460) — the PURE planner that decides which PUTs the
// unmount flush should fire to persist a builder's pending (dirty) edits.
// No React, no fetch, no timers: it is exercised here as a plain function.
// Slice 2 (#461) wires this into useAutoSave's unmount cleanup.

import { describe, it, expect } from "vitest";

import { planUnmountFlush, pickLineItemFields } from "./use-auto-save";
import type { AutoSaveConfig } from "@/lib/types";

// ── Test fixtures ────────────────────────────────────────────────────────────

// An index signature (not an interface) so items satisfy pickLineItemFields's
// `{ id: string } & Record<string, unknown>` parameter, matching the runtime
// shape of estimate/invoice line items.
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

describe("planUnmountFlush (#460)", () => {
  it("plans a root PUT when the entity's root fields are dirty", () => {
    const config = makeConfig();
    const entity = makeEntity({ title: "Roof repair — edited" });

    const plan = planUnmountFlush(config, entity, {
      rootSnapshot: { title: "Roof repair" },
      lineItems: new Map(),
      updatedAt: "2026-06-05T00:00:00Z",
      staleConflict: false,
    });

    expect(plan.rootPut).not.toBeNull();
    expect(plan.rootPut?.path).toBe("/api/estimates/est-1");
    expect(plan.rootPut?.body).toMatchObject({ title: "Roof repair — edited" });
  });

  it("plans nothing when the entity is clean (root matches snapshot, no items)", () => {
    const config = makeConfig();
    const entity = makeEntity({ title: "Roof repair" });

    const plan = planUnmountFlush(config, entity, {
      rootSnapshot: { title: "Roof repair" },
      lineItems: new Map(),
      updatedAt: "2026-06-05T00:00:00Z",
      staleConflict: false,
    });

    expect(plan).toEqual({ rootPut: null, lineItemPuts: [] });
  });

  it("plans nothing when a stale conflict is active, even if dirty", () => {
    const config = makeConfig();
    const entity = makeEntity({ title: "Roof repair — edited" });

    const plan = planUnmountFlush(config, entity, {
      rootSnapshot: { title: "Roof repair" },
      lineItems: new Map(),
      updatedAt: "2026-06-05T00:00:00Z",
      staleConflict: true,
    });

    expect(plan).toEqual({ rootPut: null, lineItemPuts: [] });
  });

  it("plans nothing when the root snapshot is not yet initialized (null)", () => {
    const config = makeConfig();
    const entity = makeEntity({ title: "Roof repair" });

    const plan = planUnmountFlush(config, entity, {
      rootSnapshot: null,
      lineItems: new Map(),
      updatedAt: "2026-06-05T00:00:00Z",
      staleConflict: false,
    });

    expect(plan).toEqual({ rootPut: null, lineItemPuts: [] });
  });

  it("attaches updated_at_snapshot to the body when concurrency is enabled", () => {
    const config = makeConfig({ hasSnapshotConcurrency: true });
    const entity = makeEntity({ title: "Roof repair — edited" });

    const plan = planUnmountFlush(config, entity, {
      rootSnapshot: { title: "Roof repair" },
      lineItems: new Map(),
      updatedAt: "2026-06-05T12:30:00Z",
      staleConflict: false,
    });

    expect(plan.rootPut?.body).toMatchObject({
      title: "Roof repair — edited",
      updated_at_snapshot: "2026-06-05T12:30:00Z",
    });
  });

  it("omits updated_at_snapshot from the body when concurrency is disabled", () => {
    const config = makeConfig({ hasSnapshotConcurrency: false });
    const entity = makeEntity({ title: "Roof repair — edited" });

    const plan = planUnmountFlush(config, entity, {
      rootSnapshot: { title: "Roof repair" },
      lineItems: new Map(),
      updatedAt: "2026-06-05T12:30:00Z",
      staleConflict: false,
    });

    expect(plan.rootPut?.body).not.toHaveProperty("updated_at_snapshot");
  });

  it("plans exactly one line-item PUT for a single dirty item (ignoring unchanged ones)", () => {
    const config = makeConfig({ hasSnapshotConcurrency: true });

    const savedItem1 = makeItem("li-1", { description: "Replace shingles" });
    const savedItem2 = makeItem("li-2", { description: "Tarp roof" });
    const dirtyItem1 = makeItem("li-1", { description: "Replace shingles — 30yr" });
    const cleanItem2 = makeItem("li-2", { description: "Tarp roof" });

    const entity = makeEntity({
      title: "Roof repair", // root clean — only the line item is dirty
      sections: [
        { items: [dirtyItem1], subsections: [{ items: [cleanItem2] }] },
      ],
    });

    const plan = planUnmountFlush(config, entity, {
      rootSnapshot: { title: "Roof repair" },
      lineItems: new Map([
        ["li-1", pickLineItemFields(savedItem1)],
        ["li-2", pickLineItemFields(savedItem2)],
      ]),
      updatedAt: "2026-06-05T12:30:00Z",
      staleConflict: false,
    });

    expect(plan.rootPut).toBeNull();
    expect(plan.lineItemPuts).toHaveLength(1);
    expect(plan.lineItemPuts[0].path).toBe(
      "/api/estimates/est-1/line-items/li-1",
    );
    expect(plan.lineItemPuts[0].body).toMatchObject({
      description: "Replace shingles — 30yr",
      updated_at_snapshot: "2026-06-05T12:30:00Z",
    });
  });

  it("plans no line-item PUTs for templates, even when items differ", () => {
    // Templates have no live DB rows behind their line items, so per-item saves
    // are gated off in the hook; the planner must match that.
    const config = makeConfig({
      entityKind: "template",
      hasSnapshotConcurrency: false,
    });

    const savedItem = makeItem("li-1", { description: "Replace shingles" });
    const dirtyItem = makeItem("li-1", { description: "Replace shingles — edited" });

    const entity = makeEntity({
      title: "Roof template",
      sections: [{ items: [dirtyItem], subsections: [] }],
    });

    const plan = planUnmountFlush(config, entity, {
      rootSnapshot: { title: "Roof template" }, // root clean
      lineItems: new Map([["li-1", pickLineItemFields(savedItem)]]),
      updatedAt: "2026-06-05T12:30:00Z",
      staleConflict: false,
    });

    expect(plan.lineItemPuts).toEqual([]);
  });
});
