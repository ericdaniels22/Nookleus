import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

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

describe("GET /api/estimates (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await GET(new Request("http://test/api/estimates"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when a non-admin lacks view_estimates", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
    });
    const res = await GET(new Request("http://test/api/estimates"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(403);
  });

  it("reaches the handler when the caller holds view_estimates", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "member", grants: ["view_estimates"] }),
    });
    // No job_id query param — the handler's own validation returns 400,
    // which only happens once the gate has passed.
    const res = await GET(new Request("http://test/api/estimates"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "job_id query param required" });
  });
});

// POST /api/estimates was removed in #571 — creation goes through
// POST /api/estimates/create-with-template (see its route.test.ts).
