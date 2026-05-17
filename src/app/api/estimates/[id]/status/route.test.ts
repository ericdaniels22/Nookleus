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
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
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
});
