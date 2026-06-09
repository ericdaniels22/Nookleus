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

// A dynamic route: the `[id]` param must pass through the wrapper untouched.
describe("PUT /api/estimates/[id]/status (converted to withRequestContext)", () => {
  function putRequest(body: unknown) {
    return new Request("http://test/api/estimates/est-1/status", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await PUT(putRequest({}), routeCtx);
    expect(res.status).toBe(401);
  });

  it("returns 403 when a non-admin lacks edit_estimates", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
    });
    const res = await PUT(putRequest({}), routeCtx);
    expect(res.status).toBe(403);
  });

  it("reaches the handler when the caller holds edit_estimates", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "member", grants: ["edit_estimates"] }),
    });
    // Empty body — the handler's own validation returns 400, which only
    // happens once the gate has passed.
    const res = await PUT(putRequest(null), routeCtx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "status required" });
  });

  // The transition gate wired in at route.ts — canTransitionEstimate(cur.status,
  // body.status) plus the cannot-void-a-converted-estimate rule. The pure 4x4
  // matrix is unit-tested in estimate-status.test.ts; these pin the route→helper
  // wiring at the HTTP boundary so a future rewiring can't silently drop the
  // rejection (or invert the gate).
  function withEstimate(row: Record<string, unknown>) {
    return useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_estimates"],
        extraTables: {
          estimates: [
            { id: "est-1", updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null, ...row },
          ],
        },
      }),
    });
  }

  it("rejects an illegal status transition with 400 invalid_transition", async () => {
    withEstimate({ status: "draft", converted_to_invoice_id: null });
    const res = await PUT(putRequest({ status: "converted" }), routeCtx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_transition", from: "draft", to: "converted" });
  });

  it("refuses to void a converted estimate with 400 cannot_void_converted", async () => {
    withEstimate({ status: "converted", converted_to_invoice_id: "inv-1" });
    const res = await PUT(putRequest({ status: "voided" }), routeCtx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "cannot_void_converted", linked_invoice_id: "inv-1" });
  });

  it("allows a legal transition (draft → sent) and writes the patch", async () => {
    const client = withEstimate({ status: "draft", converted_to_invoice_id: null });
    const res = await PUT(putRequest({ status: "sent" }), routeCtx);
    expect(res.status).toBe(200);
    const update = client.__mutations.find((m) => m.table === "estimates" && m.op === "update");
    const payload = update?.payload as { status?: string; sent_at?: string } | undefined;
    expect(payload?.status).toBe("sent");
    expect(typeof payload?.sent_at).toBe("string");
  });
});
