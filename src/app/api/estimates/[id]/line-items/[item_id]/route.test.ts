import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { PUT } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { fakeUserClient, memberTables } from "../../../../__test-utils__/request-context-fakes";

const routeCtx = { params: Promise.resolve({ id: "est-1", item_id: "item-1" }) };

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
  return new Request("http://test/api/estimates/est-1/line-items/item-1", {
    method: "PUT",
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
      estimate_line_items: [
        { id: "item-1", estimate_id: "est-1", section_id: "sec-1", quantity: 1, unit_price: 100, total: 100 },
      ],
    },
  });
}

describe("PUT /api/estimates/[id]/line-items/[item_id] — line-item note (#382)", () => {
  it("persists an updated note", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await PUT(putRequest({ note: "Use low-VOC primer" }), routeCtx);

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd?.payload).toMatchObject({ note: "Use low-VOC primer" });
  });

  it("clears the note when null is sent", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await PUT(putRequest({ note: null }), routeCtx);

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd?.payload).toMatchObject({ note: null });
  });

  it("rejects a note longer than 2000 chars", async () => {
    useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await PUT(putRequest({ note: "x".repeat(2001) }), routeCtx);

    expect(res.status).toBe(400);
  });
});

describe("PUT /api/estimates/[id]/line-items/[item_id] — equipment pricing (#682)", () => {
  it("derives quantity, note, and total from pieces × days, overriding disagreeing client values", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await PUT(
      putRequest({
        pricing_mode: "pieces_days",
        pieces: 3,
        days: 10,
        // A buggy/stale client could send these; the server must ignore them.
        quantity: 999,
        note: "stale manual note",
      }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    // quantity = 3 × 10; total = quantity × unit_price (100); note derived.
    expect(upd?.payload).toMatchObject({
      pricing_mode: "pieces_days",
      pieces: 3,
      days: 10,
      quantity: 30,
      note: "3 units for 10 days",
      total: 3000,
    });
  });

  it("rejects non-positive pieces or days", async () => {
    // The server is authoritative for equipment rows; a stale/buggy/direct call
    // must not persist a "0 units" or negative-quantity rental.
    useUser({ user: { id: "user-1" }, tables: seed() });
    expect(
      (await PUT(putRequest({ pricing_mode: "pieces_days", pieces: 0, days: 5 }), routeCtx)).status,
    ).toBe(400);

    useUser({ user: { id: "user-1" }, tables: seed() });
    expect(
      (await PUT(putRequest({ pricing_mode: "pieces_days", pieces: -2, days: 5 }), routeCtx)).status,
    ).toBe(400);

    useUser({ user: { id: "user-1" }, tables: seed() });
    expect(
      (await PUT(putRequest({ pricing_mode: "pieces_days", pieces: 3, days: 0 }), routeCtx)).status,
    ).toBe(400);

    useUser({ user: { id: "user-1" }, tables: seed() });
    expect(
      (await PUT(putRequest({ pricing_mode: "pieces_days", pieces: 3, days: -1 }), routeCtx)).status,
    ).toBe(400);
  });

  it("releases server-owned derivation when switching back to standard", async () => {
    const tables = memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_estimates"],
      extraTables: {
        estimates: [{ id: "est-1", deleted_at: null, updated_at: "2026-06-01T00:00:00Z" }],
        estimate_line_items: [
          {
            id: "item-1",
            estimate_id: "est-1",
            section_id: "sec-1",
            quantity: 30,
            unit_price: 100,
            total: 3000,
            pricing_mode: "pieces_days",
            pieces: 3,
            days: 10,
            note: "3 units for 10 days",
          },
        ],
      },
    });
    const client = useUser({ user: { id: "user-1" }, tables });

    // Mirrors toStandardMode(): clears pieces/days, keeps the last quantity,
    // releases the note slot back to manual control (empty → null).
    const res = await PUT(
      putRequest({
        pricing_mode: "standard",
        pieces: null,
        days: null,
        quantity: 30,
        note: "",
      }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd?.payload).toMatchObject({
      pricing_mode: "standard",
      pieces: null,
      days: null,
      quantity: 30,
      note: null,
    });
  });
});
