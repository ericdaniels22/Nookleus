import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import * as invoicesRoute from "./route";
import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { fakeUserClient, memberTables } from "../__test-utils__/request-context-fakes";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

describe("GET /api/invoices (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await GET(new Request("http://test/api/invoices"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when a non-admin lacks view_invoices", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
    });
    const res = await GET(new Request("http://test/api/invoices"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(403);
  });
});

describe("direct invoice creation is retired (#386)", () => {
  it("no longer exposes a POST handler — convert is the sole creation path", () => {
    // The direct-create endpoint behind the removed "new invoice" page is gone;
    // an invoice now only comes into existence via estimate conversion.
    expect(Object.keys(invoicesRoute)).not.toContain("POST");
  });

  it("still exposes GET for the per-job invoice list", () => {
    expect(Object.keys(invoicesRoute)).toContain("GET");
    expect(typeof invoicesRoute.GET).toBe("function");
  });
});
