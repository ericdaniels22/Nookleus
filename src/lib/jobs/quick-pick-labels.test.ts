import { describe, expect, it, vi } from "vitest";

import { loadQuickPickLabels } from "./quick-pick-labels";
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
