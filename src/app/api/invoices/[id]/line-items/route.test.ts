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
import { fakeUserClient, memberTables } from "../../../__test-utils__/request-context-fakes";

const routeCtx = { params: Promise.resolve({ id: "inv-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function putRequest(body: unknown) {
  return new Request("http://test/api/invoices/inv-1/line-items", {
    method: "PUT",
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
