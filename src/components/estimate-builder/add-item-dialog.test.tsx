// Slice 5 of the #681 add-then-reorder fix. The create-line-item POST now
// returns the parent's freshly-bumped updated_at (Slices 1–2). The dialog must
// hand that token to onAdded as meta so the builder can adopt it before the
// reorder PUT — otherwise that PUT carries a stale snapshot, 409s, and the new
// row is stranded at the bottom. Here we drive the real Custom tab and assert
// onAdded receives (line_item, { updated_at }).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import { AddItemDialog } from "./add-item-dialog";
import type { ItemLibraryItem } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({
        line_item: { id: "NEW", section_id: "sec-1", description: "Dump fees" },
        updated_at: "2026-03-03T00:00:00Z",
      }),
    } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function addCustomItem(mode: "estimate" | "invoice") {
  const onAdded = vi.fn();
  render(
    <AddItemDialog
      open
      onOpenChange={() => {}}
      estimateId={mode === "invoice" ? "inv-1" : "est-1"}
      sectionId="sec-1"
      onAdded={onAdded}
      initialTab="custom"
      mode={mode}
    />,
  );

  fireEvent.change(screen.getByLabelText(/description/i), {
    target: { value: "Dump fees" },
  });
  fireEvent.change(screen.getByLabelText(/unit price/i), {
    target: { value: "120" },
  });
  fireEvent.click(screen.getByRole("button", { name: /add item/i }));

  await waitFor(() => expect(onAdded).toHaveBeenCalled());
  return onAdded;
}

describe("AddItemDialog → onAdded meta (#681)", () => {
  it("threads the estimate POST's updated_at to onAdded as meta", async () => {
    const onAdded = await addCustomItem("estimate");
    expect(onAdded.mock.calls[0][1]).toEqual({ updated_at: "2026-03-03T00:00:00Z" });
  });

  it("threads the invoice POST's updated_at to onAdded as meta", async () => {
    const onAdded = await addCustomItem("invoice");
    expect(onAdded.mock.calls[0][1]).toEqual({ updated_at: "2026-03-03T00:00:00Z" });
  });
});

// #685 — adding an equipment-category library item must seed Pieces × Days at
// add time. The dialog computes the seed from the library item via
// `seedFromLibraryItem` and posts pricing_mode + raw pieces/days alongside the
// create call; the route persists them and owns the derived quantity/note/total
// (covered by route.test.ts). Here we drive the real From-Library tab and assert
// the POST body carries the seed.

const equipmentItem: ItemLibraryItem = {
  id: "lib-air-mover",
  organization_id: "org-1",
  name: "Air mover",
  description: "Axial air mover rental",
  code: "EQ-AM",
  category: "equipment",
  default_quantity: 3,
  default_unit: "day",
  unit_price: 100,
  damage_type_tags: [],
  section_tags: [],
  is_active: true,
  sort_order: 0,
  created_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const laborItem: ItemLibraryItem = {
  ...equipmentItem,
  id: "lib-cleanup",
  name: "Cleanup crew",
  description: "Hourly cleanup labor",
  code: "LAB-01",
  category: "labor",
  default_quantity: 2,
  default_unit: "hr",
  unit_price: 50,
};

// URL-aware fetch: GET /api/item-library lists the library; POST create returns
// a row. Records every call so a test can read the create POST's parsed body.
function stubLibraryFetch(libraryItems: ItemLibraryItem[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mock = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (typeof url === "string" && url.startsWith("/api/item-library")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ items: libraryItems }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({
        line_item: { id: "NEW", section_id: "sec-1" },
        updated_at: "2026-03-03T00:00:00Z",
      }),
    } as Response);
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

async function addFromLibrary(
  target: ItemLibraryItem,
  libraryItems: ItemLibraryItem[],
  mode: "estimate" | "invoice" = "estimate",
) {
  const calls = stubLibraryFetch(libraryItems);
  render(
    <AddItemDialog
      open
      onOpenChange={() => {}}
      estimateId={mode === "invoice" ? "inv-1" : "est-1"}
      sectionId="sec-1"
      onAdded={vi.fn()}
      initialTab="library"
      mode={mode}
    />,
  );
  const row = (await screen.findByText(target.name)).closest("li") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: /add/i }));
  await waitFor(() =>
    expect(calls.some((c) => c.init?.method === "POST")).toBe(true),
  );
  const post = calls.find((c) => c.init?.method === "POST")!;
  return JSON.parse(post.init!.body as string) as Record<string, unknown>;
}

describe("AddItemDialog → equipment library seed (#685)", () => {
  it("seeds an equipment item into Pieces × Days (pieces ← default_quantity, days 1)", async () => {
    const body = await addFromLibrary(equipmentItem, [equipmentItem, laborItem]);
    expect(body).toMatchObject({
      section_id: "sec-1",
      library_item_id: "lib-air-mover",
      pricing_mode: "pieces_days",
      pieces: 3,
      days: 1,
    });
  });

  it("adds a non-equipment item as Standard (no pieces/days)", async () => {
    const body = await addFromLibrary(laborItem, [equipmentItem, laborItem]);
    expect(body).toMatchObject({
      library_item_id: "lib-cleanup",
      pricing_mode: "standard",
      pieces: null,
      days: null,
    });
  });

  it("does not seed equipment pricing in invoice mode (#684 wires that separately)", async () => {
    const body = await addFromLibrary(equipmentItem, [equipmentItem, laborItem], "invoice");
    expect(body).not.toHaveProperty("pricing_mode");
    expect(body).not.toHaveProperty("pieces");
    expect(body).not.toHaveProperty("days");
  });
});
