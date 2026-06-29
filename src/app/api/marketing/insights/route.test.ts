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
const getReq = () => new Request("http://test/api/marketing/insights");

function useUser(opts: Parameters<typeof fakeClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeClient(opts) as never,
  );
}

function useService(tables?: Record<string, Record<string, unknown>[]>) {
  vi.mocked(createServiceClient).mockReturnValue(fakeClient({ tables }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// GET /api/marketing/insights — the Insights screen's day-level history for this
// Organization. Admin only (insight_metric is admin-only RLS); served over the
// service client with an explicit org filter, mirroring /api/google/reviews. The
// flat store rows are folded into one series per (source, metric).
describe("GET /api/marketing/insights", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    useService();
    const res = await GET(getReq(), noParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-admin even with marketing permissions", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({
        userId: "u-1",
        role: "member",
        grants: ["view_marketing", "manage_marketing"],
      }),
    });
    useService();
    const res = await GET(getReq(), noParams);
    expect(res.status).toBe(403);
  });

  it("returns day-level series for both sources to an admin, scoped to the org", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "admin" }),
    });
    useService({
      insight_metric: [
        {
          organization_id: "org-1",
          source: "business_profile",
          metric_date: "2026-06-25",
          metric: "calls",
          value: 12,
        },
        {
          organization_id: "org-1",
          source: "business_profile",
          metric_date: "2026-06-24",
          metric: "calls",
          value: 9,
        },
        {
          organization_id: "org-1",
          source: "search_console",
          metric_date: "2026-06-25",
          metric: "clicks",
          value: 88,
        },
        // A different Organization's row must never leak into the result.
        {
          organization_id: "org-2",
          source: "business_profile",
          metric_date: "2026-06-25",
          metric: "calls",
          value: 999,
        },
      ],
    });

    const res = await GET(getReq(), noParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    // Two series — business_profile|calls and search_console|clicks; org-2 out.
    expect(body.series).toHaveLength(2);
    const calls = body.series.find(
      (s: { source: string; metric: string }) =>
        s.source === "business_profile" && s.metric === "calls",
    );
    expect(calls.points).toEqual([
      { date: "2026-06-24", value: 9 },
      { date: "2026-06-25", value: 12 },
    ]);
    const clicks = body.series.find(
      (s: { source: string; metric: string }) =>
        s.source === "search_console" && s.metric === "clicks",
    );
    expect(clicks.points).toEqual([{ date: "2026-06-25", value: 88 }]);
  });
});
