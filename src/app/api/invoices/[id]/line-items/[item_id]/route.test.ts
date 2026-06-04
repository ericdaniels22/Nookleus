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

const routeCtx = { params: Promise.resolve({ id: "inv-1", item_id: "item-1" }) };

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
  return new Request("http://test/api/invoices/inv-1/line-items/item-1", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

function seed() {
  return memberTables({
    userId: "user-1",
    role: "member",
    grants: ["edit_invoices"],
    extraTables: {
      invoices: [{ id: "inv-1", deleted_at: null, updated_at: "2026-06-01T00:00:00Z" }],
      invoice_line_items: [
        { id: "item-1", invoice_id: "inv-1", quantity: 1, unit_price: 100, amount: 100 },
      ],
    },
  });
}

describe("PUT /api/invoices/[id]/line-items/[item_id] — line-item note (#382)", () => {
  it("persists an updated note", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await PUT(putRequest({ note: "Customer-approved substitution" }), routeCtx);

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "invoice_line_items" && m.op === "update",
    );
    expect(upd?.payload).toMatchObject({ note: "Customer-approved substitution" });
  });

  it("clears the note when null is sent", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await PUT(putRequest({ note: null }), routeCtx);

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "invoice_line_items" && m.op === "update",
    );
    expect(upd?.payload).toMatchObject({ note: null });
  });

  it("rejects a note longer than 2000 chars", async () => {
    useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await PUT(putRequest({ note: "x".repeat(2001) }), routeCtx);

    expect(res.status).toBe(400);
  });
});
