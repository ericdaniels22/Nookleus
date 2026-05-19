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
  fakeUserClient,
  fakeServiceClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

function paramsFor(activityId: string) {
  return { params: Promise.resolve({ activityId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/expenses/by-activity/[activityId] (org-scoped via the guard)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({}).client as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("act-1"));

    expect(res.status).toBe(401);
  });

  it("returns the activity's expense when its job is in the caller's Active Organization", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: {
          job_activities: [{ id: "act-1", job_id: "job-1" }],
          jobs: [{ id: "job-1", organization_id: "org-1" }],
          expenses: [{ id: "exp-1", activity_id: "act-1" }],
        },
      }).client as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("act-1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("exp-1");
  });

  it("returns 404 for an activity id whose job belongs to another Organization", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: {
          job_activities: [{ id: "act-1", job_id: "job-2" }],
          jobs: [{ id: "job-2", organization_id: "org-2" }],
          expenses: [{ id: "exp-1", activity_id: "act-1" }],
        },
      }).client as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("act-1"));

    expect(res.status).toBe(404);
  });
});
