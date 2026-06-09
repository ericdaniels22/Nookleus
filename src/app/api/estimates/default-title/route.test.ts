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
import {
  fakeUserClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function getRequest() {
  return new Request("http://test/api/estimates/default-title");
}

describe("GET /api/estimates/default-title", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await GET(getRequest(), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when a non-admin lacks create_estimates", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
    });
    const res = await GET(getRequest(), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
  });

  it("returns the Organization's standard Estimate title", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["create_estimates"],
        extraTables: {
          company_settings: [
            {
              organization_id: "org-1",
              key: "default_estimate_title",
              value: "Scope of Work",
            },
          ],
        },
      }),
    });
    const res = await GET(getRequest(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "Scope of Work" });
  });

  it("falls back to Estimate when the setting is absent", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["create_estimates"],
      }),
    });
    const res = await GET(getRequest(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "Estimate" });
  });
});
