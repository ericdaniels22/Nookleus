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
