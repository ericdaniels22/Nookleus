import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { fakeUserClient, memberTables } from "../../../__test-utils__/request-context-fakes";

const routeCtx = { params: Promise.resolve({ id: "est-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  const client = fakeUserClient(opts);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return client;
}

function postRequest(body: unknown) {
  return new Request("http://test/api/estimates/est-1/line-items", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function seed() {
  return memberTables({
    userId: "user-1",
    role: "member",
    grants: ["edit_estimates"],
    extraTables: {
      estimates: [{ id: "est-1", deleted_at: null, updated_at: "2026-06-01T00:00:00Z" }],
      estimate_sections: [{ id: "sec-1", estimate_id: "est-1" }],
      estimate_line_items: [],
    },
  });
}

describe("POST /api/estimates/[id]/line-items — line-item note (#382)", () => {
  it("persists a custom item's note onto the inserted row", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(
      postRequest({
        section_id: "sec-1",
        description: "Replace shingles",
        quantity: 1,
        unit_price: 100,
        note: "Match existing shingle color",
      }),
      routeCtx,
    );

    expect(res.status).toBe(201);
    const insert = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "insert",
    );
    expect(insert?.payload).toMatchObject({ note: "Match existing shingle color" });
  });

  it("inserts note: null when the field is omitted", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(
      postRequest({
        section_id: "sec-1",
        description: "Replace shingles",
        quantity: 1,
        unit_price: 100,
      }),
      routeCtx,
    );

    expect(res.status).toBe(201);
    const insert = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "insert",
    );
    expect(insert?.payload).toMatchObject({ note: null });
  });

  it("rejects a note longer than 2000 chars", async () => {
    useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(
      postRequest({
        section_id: "sec-1",
        description: "Replace shingles",
        quantity: 1,
        unit_price: 100,
        note: "x".repeat(2001),
      }),
      routeCtx,
    );

    expect(res.status).toBe(400);
  });
});

// #681 — the POST-then-reorder add flow needs the parent estimate's fresh
// updated_at so the immediately-following reorder PUT carries a non-stale
// snapshot. Without it the reorder 409s, latches the stale-conflict guard, and
// the new row never reaches the top (it's stranded at the bottom server-side).
describe("POST /api/estimates/[id]/line-items — returns the parent updated_at (#681)", () => {
  it("includes the estimate's current updated_at alongside the created line_item", async () => {
    useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(
      postRequest({
        section_id: "sec-1",
        description: "Replace shingles",
        quantity: 1,
        unit_price: 100,
      }),
      routeCtx,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { line_item: unknown; updated_at: string };
    expect(body).toHaveProperty("line_item");
    expect(body.updated_at).toBe("2026-06-01T00:00:00Z");
  });
});

// #685 — equipment library items seed Pieces × Days at add time. The dialog
// computes the seed via `seedFromLibraryItem` and posts pricing_mode + raw
// pieces/days; the create route persists them and — like the per-item PUT —
// owns the collapsed quantity, the derived note, and the total so a stale or
// buggy client can't drift `quantity` from `pieces × days`.
describe("POST /api/estimates/[id]/line-items — equipment pricing seed (#685)", () => {
  function seedWithLibrary() {
    return memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_estimates"],
      extraTables: {
        estimates: [{ id: "est-1", deleted_at: null, updated_at: "2026-06-01T00:00:00Z" }],
        estimate_sections: [{ id: "sec-1", estimate_id: "est-1" }],
        estimate_line_items: [],
        item_library: [
          {
            id: "lib-air-mover",
            name: "Air mover",
            description: "Axial air mover rental",
            code: "EQ-AM",
            default_unit: "day",
            unit_price: 100,
            is_active: true,
          },
        ],
      },
    });
  }

  it("persists pricing_mode/pieces/days and derives quantity, note and total", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seedWithLibrary() });

    const res = await POST(
      postRequest({
        section_id: "sec-1",
        library_item_id: "lib-air-mover",
        // The dialog seeds default_quantity → pieces over a single day.
        quantity: 3,
        pricing_mode: "pieces_days",
        pieces: 3,
        days: 1,
      }),
      routeCtx,
    );

    expect(res.status).toBe(201);
    const insert = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "insert",
    );
    expect(insert?.payload).toMatchObject({
      pricing_mode: "pieces_days",
      pieces: 3,
      days: 1,
      // Server owns the collapsed quantity (pieces × days), the derived note,
      // and the total (pieces × days × unit_price) — 3 × 1 × $100.
      quantity: 3,
      note: "3 units for 1 day",
      total: 300,
    });
  });

  it("adds a non-equipment library item as Standard (no pieces/days)", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seedWithLibrary() });

    // The dialog's seed for a non-equipment category posts pricing_mode standard
    // with null pieces/days; the row must persist as a plain Quantity line.
    const res = await POST(
      postRequest({
        section_id: "sec-1",
        library_item_id: "lib-air-mover",
        quantity: 2,
        pricing_mode: "standard",
        pieces: null,
        days: null,
      }),
      routeCtx,
    );

    expect(res.status).toBe(201);
    const insert = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "insert",
    );
    expect(insert?.payload).toMatchObject({
      pricing_mode: "standard",
      pieces: null,
      days: null,
      quantity: 2,
    });
  });

  it("rejects a non-positive piece count (no 0-units rentals)", async () => {
    useUser({ user: { id: "user-1" }, tables: seedWithLibrary() });

    const res = await POST(
      postRequest({
        section_id: "sec-1",
        library_item_id: "lib-air-mover",
        quantity: 1,
        pricing_mode: "pieces_days",
        pieces: 0,
        days: 1,
      }),
      routeCtx,
    );

    expect(res.status).toBe(400);
  });
});
