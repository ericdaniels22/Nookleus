import { describe, expect, it, vi } from "vitest";

import {
  buildReorderPayload,
  loadQuickPickLabels,
  moveOrgLabel,
} from "./quick-pick-labels";
import type { QuickPickLabel } from "@/lib/types";

function label(id: string, text: string, sort: number): QuickPickLabel {
  return {
    id,
    organization_id: null,
    label: text,
    sort_order: sort,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  };
}

// A NULL-org shared default (immovable, pinned at the top of the list).
function def(id: string, text: string, sort: number): QuickPickLabel {
  return { ...label(id, text, sort), organization_id: null };
}

// An org-owned label (the only kind a reorder may move).
function org(id: string, text: string, sort: number): QuickPickLabel {
  return { ...label(id, text, sort), organization_id: "org-1" };
}

function fetchReturning(rows: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(rows),
  }) as unknown as typeof fetch;
}

describe("loadQuickPickLabels — read the org's Quick-pick labels for the annotator", () => {
  it("returns the labels in the order the API supplied them", async () => {
    const rows = [
      label("a", "Source of loss", 0),
      label("b", "Pre-existing damage", 1),
    ];

    const result = await loadQuickPickLabels(fetchReturning(rows));

    expect(result).toEqual(rows);
  });

  it("returns an empty list when the request is not ok", async () => {
    const result = await loadQuickPickLabels(
      fetchReturning({ error: "Forbidden" }, false)
    );

    expect(result).toEqual([]);
  });

  it("returns an empty list when the fetch itself rejects", async () => {
    const failing = vi
      .fn()
      .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const result = await loadQuickPickLabels(failing);

    expect(result).toEqual([]);
  });

  it("returns an empty list when the body is not an array", async () => {
    const result = await loadQuickPickLabels(
      fetchReturning({ unexpected: "shape" })
    );

    expect(result).toEqual([]);
  });
});

// Reordering the org's Quick-pick labels (#856). The list shows the shared
// NULL-org defaults (immovable, pinned on top) above the org's own rows. A
// reorder may only move the org rows, and must assign them a sort_order that
// never collides with a default's — otherwise the persisted order is
// non-deterministic after a refresh.
describe("buildReorderPayload — collision-free sort_order for the org's rows", () => {
  it("assigns org rows a sort_order strictly above every default's", () => {
    const labels = [
      def("d1", "Source of loss", 1),
      def("d2", "Moisture Reading", 2),
      def("d3", "Visible Damage", 3),
      org("o1", "Mine A", 4),
      org("o2", "Mine B", 5),
    ];

    const payload = buildReorderPayload(labels);

    expect(payload).toEqual([
      { id: "o1", label: "Mine A", sort_order: 4 },
      { id: "o2", label: "Mine B", sort_order: 5 },
    ]);
  });

  it("numbers org rows by their display order, not their old sort_order", () => {
    // o2 has been moved above o1 in the displayed list; the payload must
    // renumber by position so the new order survives a refresh.
    const labels = [
      def("d1", "Source of loss", 1),
      def("d2", "Moisture Reading", 2),
      org("o2", "Mine B", 5),
      org("o1", "Mine A", 4),
    ];

    expect(buildReorderPayload(labels)).toEqual([
      { id: "o2", label: "Mine B", sort_order: 3 },
      { id: "o1", label: "Mine A", sort_order: 4 },
    ]);
  });

  it("heals an org row that had collided with a default's sort_order", () => {
    // A prior buggy reorder gave o1 sort_order 1 — colliding with default d1.
    // Reordering must lift every org row clear of the defaults again.
    const labels = [
      org("o1", "Mine A", 1),
      def("d1", "Source of loss", 1),
      def("d2", "Moisture Reading", 2),
    ];

    const payload = buildReorderPayload(labels);
    const maxDefault = 2;
    expect(payload.every((p) => p.sort_order > maxDefault)).toBe(true);
    expect(payload).toEqual([{ id: "o1", label: "Mine A", sort_order: 3 }]);
  });

  it("converges: re-applying a built payload yields the same sort_order", () => {
    const defaults = [def("d1", "Source of loss", 1), def("d2", "Moisture Reading", 2)];
    const orgRows = [org("o1", "Mine A", 4), org("o2", "Mine B", 5)];

    const first = buildReorderPayload([...defaults, ...orgRows]);
    // Fold the persisted sort_order back into the rows, as a refresh would.
    const persisted = orgRows.map((ql) => ({
      ...ql,
      sort_order: first.find((p) => p.id === ql.id)!.sort_order,
    }));

    const second = buildReorderPayload([...defaults, ...persisted]);
    expect(second).toEqual(first);
  });
});

// moveOrgLabel reorders only the org's own rows; the immovable defaults always
// stay pinned at the top in their original order. `orgIndex` is the position
// among the org rows (not the full list).
describe("moveOrgLabel — swap org rows, defaults stay pinned", () => {
  const labels = () => [
    def("d1", "Source of loss", 1),
    def("d2", "Moisture Reading", 2),
    org("o1", "Mine A", 3),
    org("o2", "Mine B", 4),
    org("o3", "Mine C", 5),
  ];

  it("moves an org row down, leaving defaults first and in order", () => {
    const result = moveOrgLabel(labels(), 0, "down");
    expect(result.map((q) => q.id)).toEqual(["d1", "d2", "o2", "o1", "o3"]);
  });

  it("moves an org row up", () => {
    const result = moveOrgLabel(labels(), 2, "up");
    expect(result.map((q) => q.id)).toEqual(["d1", "d2", "o1", "o3", "o2"]);
  });

  it("is a no-op when the first org row tries to move up past the defaults", () => {
    const result = moveOrgLabel(labels(), 0, "up");
    expect(result.map((q) => q.id)).toEqual(["d1", "d2", "o1", "o2", "o3"]);
  });

  it("is a no-op when the last org row tries to move down", () => {
    const result = moveOrgLabel(labels(), 2, "down");
    expect(result.map((q) => q.id)).toEqual(["d1", "d2", "o1", "o2", "o3"]);
  });
});
