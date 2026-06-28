import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { PUT, POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { fakeUserClient, memberTables } from "../../../__test-utils__/request-context-fakes";

const routeCtx = { params: Promise.resolve({ id: "inv-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  const client = fakeUserClient(opts);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return client;
}

function putRequest(body: unknown) {
  return new Request("http://test/api/invoices/inv-1/line-items", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

function postRequest(body: unknown) {
  return new Request("http://test/api/invoices/inv-1/line-items", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// #265 — the route is being aligned with the client (use-auto-save.ts's
// `saveLineItemsReorder`), which sends `{ items: [...] }`, and with the
// sibling estimate route, which already reads `body.items`.
describe("PUT /api/invoices/[id]/line-items (#265 reorder field rename)", () => {
  it("accepts { items: [...] } and returns 200 OK", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_invoices"],
        extraTables: {
          invoices: [{ id: "inv-1", deleted_at: null, updated_at: "2026-05-01T00:00:00Z" }],
        },
      }),
    });

    const res = await PUT(putRequest({ items: [] }), routeCtx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, updated_at: "2026-05-01T00:00:00Z" });
  });

  it("returns 400 when body has no items array (e.g. legacy `reorder` field only)", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_invoices"],
        extraTables: {
          invoices: [{ id: "inv-1", deleted_at: null, updated_at: "2026-05-01T00:00:00Z" }],
        },
      }),
    });

    const res = await PUT(putRequest({ reorder: [] }), routeCtx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "items array required" });
  });
});

describe("POST /api/invoices/[id]/line-items — line-item note (#382)", () => {
  function seed() {
    return memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_invoices"],
      extraTables: {
        invoices: [{ id: "inv-1", deleted_at: null, updated_at: "2026-05-01T00:00:00Z" }],
        invoice_sections: [{ id: "sec-1", invoice_id: "inv-1" }],
        invoice_line_items: [],
      },
    });
  }

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

    expect(res.status).toBe(200);
    const insert = client.__mutations.find(
      (m) => m.table === "invoice_line_items" && m.op === "insert",
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

    expect(res.status).toBe(200);
    const insert = client.__mutations.find(
      (m) => m.table === "invoice_line_items" && m.op === "insert",
    );
    expect(insert?.payload).toMatchObject({ note: null });
  });
});

// #681 — the POST-then-reorder add flow needs the parent invoice's fresh
// updated_at so the immediately-following reorder PUT carries a non-stale
// snapshot. Without it the reorder 409s, latches the stale-conflict guard, and
// the new row never reaches the top (it's stranded at the bottom server-side).
describe("POST /api/invoices/[id]/line-items — returns the parent updated_at (#681)", () => {
  function seed() {
    return memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_invoices"],
      extraTables: {
        invoices: [{ id: "inv-1", deleted_at: null, updated_at: "2026-05-01T00:00:00Z" }],
        invoice_sections: [{ id: "sec-1", invoice_id: "inv-1" }],
        invoice_line_items: [],
      },
    });
  }

  it("includes the invoice's current updated_at alongside the created line_item", async () => {
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

    expect(res.status).toBe(200);
    const body = (await res.json()) as { line_item: unknown; updated_at: string };
    expect(body).toHaveProperty("line_item");
    expect(body.updated_at).toBe("2026-05-01T00:00:00Z");
  });
});

// #679 review parity — the estimate create route already accepts the equipment
// seed (#685); the invoice route silently dropped pricing_mode/pieces/days, so
// any caller that posts an equipment row to an invoice got a Standard row back.
// Mirror the estimate route (and the invoice per-item PUT from #684): persist the
// raw inputs and own the collapsed quantity, derived note, and amount so a stale
// or buggy client can't drift `quantity` from `pieces × days`.
describe("POST /api/invoices/[id]/line-items — equipment pricing seed (#679 parity)", () => {
  function seedWithLibrary() {
    return memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_invoices"],
      extraTables: {
        invoices: [{ id: "inv-1", deleted_at: null, updated_at: "2026-05-01T00:00:00Z" }],
        invoice_sections: [{ id: "sec-1", invoice_id: "inv-1" }],
        invoice_line_items: [],
        item_library: [
          {
            id: "lib-air-mover",
            name: "Air mover",
            description: "Axial air mover rental",
            code: "EQ-AM",
            default_quantity: 1,
            default_unit: "day",
            unit_price: 100,
            is_active: true,
          },
        ],
      },
    });
  }

  it("persists pricing_mode/pieces/days and derives quantity, note and amount", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seedWithLibrary() });

    const res = await POST(
      postRequest({
        section_id: "sec-1",
        library_item_id: "lib-air-mover",
        quantity: 3,
        pricing_mode: "pieces_days",
        pieces: 3,
        days: 1,
      }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    const insert = client.__mutations.find(
      (m) => m.table === "invoice_line_items" && m.op === "insert",
    );
    expect(insert?.payload).toMatchObject({
      pricing_mode: "pieces_days",
      pieces: 3,
      days: 1,
      // Server owns the collapsed quantity (pieces × days), the derived note,
      // and the amount (pieces × days × unit_price) — 3 × 1 × $100.
      quantity: 3,
      note: "3 units for 1 day",
      amount: 300,
    });
  });

  it("adds a non-equipment library item as Standard (no pieces/days)", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seedWithLibrary() });

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

    expect(res.status).toBe(200);
    const insert = client.__mutations.find(
      (m) => m.table === "invoice_line_items" && m.op === "insert",
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
