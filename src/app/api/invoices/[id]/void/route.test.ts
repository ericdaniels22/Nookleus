import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { fakeUserClient, fakeServiceClient } from "../../../__test-utils__/request-context-fakes";

const routeCtx = { params: Promise.resolve({ id: "inv-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createServiceClient).mockReturnValue(fakeServiceClient() as never);
});

function voidRequest() {
  return new Request("http://test/api/invoices/inv-1/void", { method: "POST" });
}

// A logged-in-only route (`{ serviceClient: true }`): any authenticated
// caller passes the gate, and the route body runs against the Service client.
describe("POST /api/invoices/[id]/void (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const res = await POST(voidRequest(), routeCtx);
    expect(res.status).toBe(401);
  });

  it("reaches the handler for any authenticated caller (no permission key required)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "user-1" } }) as never,
    );
    // The Service-client fake has no invoices row, so the handler's own
    // lookup returns 404 — proving the gate passed and the body ran.
    const res = await POST(voidRequest(), routeCtx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});
