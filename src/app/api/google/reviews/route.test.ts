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

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeClient,
  memberTables,
} from "@/lib/request-context/__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };
const getReq = () => new Request("http://test/api/google/reviews");

function useUser(opts: Parameters<typeof fakeClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(fakeClient(opts) as never);
}

function useService(tables?: Record<string, Record<string, unknown>[]>) {
  vi.mocked(createServiceClient).mockReturnValue(fakeClient({ tables }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// GET /api/google/reviews — the Marketing inbox read. Admin-only, org-scoped,
// served over the service client. Mirrors /api/google/connection's guard.
describe("GET /api/google/reviews", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    useService();
    const res = await GET(getReq(), noParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-admin even with a marketing permission grant", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({
        userId: "u-1",
        role: "member",
        grants: ["view_marketing"],
      }),
    });
    useService();
    const res = await GET(getReq(), noParams);
    expect(res.status).toBe(403);
  });

  it("returns 200 for an admin with the org's reviews, unreplied first", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "admin" }),
    });
    useService({
      google_review: [
        {
          id: "replied",
          organization_id: "org-1",
          replied: true,
          review_created_at: "2026-06-10T00:00:00Z",
        },
        {
          id: "unreplied",
          organization_id: "org-1",
          replied: false,
          review_created_at: "2026-06-01T00:00:00Z",
        },
        {
          id: "other-org",
          organization_id: "org-2",
          replied: false,
          review_created_at: "2026-06-20T00:00:00Z",
        },
      ],
    });

    const res = await GET(getReq(), noParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    // Only this org's reviews, unreplied before replied.
    expect(body.reviews.map((r: { id: string }) => r.id)).toEqual([
      "unreplied",
      "replied",
    ]);
  });
});
