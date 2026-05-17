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
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../__test-utils__/request-context-fakes";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// Soft-delete carried the `requireJobsDelete` gate (admin OR office_staff);
// it now rides on the `roles` rule. These tests pin that 1:1 mapping.
describe("POST /api/jobs/[id]/delete (converted to withRequestContext, roles rule)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await POST(new Request("http://test"), paramsFor("job-1"));

    expect(res.status).toBe(401);
  });

  it("returns 403 for a member role, even one holding permission grants", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["log_expenses", "view_billing"],
        }),
      }) as never,
    );

    const res = await POST(new Request("http://test"), paramsFor("job-1"));

    expect(res.status).toBe(403);
  });

  it("allows an office_staff caller", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "office_staff" }),
      }) as never,
    );

    const res = await POST(new Request("http://test"), paramsFor("job-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("allows an admin caller", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "admin" }),
      }) as never,
    );

    const res = await POST(new Request("http://test"), paramsFor("job-1"));

    expect(res.status).toBe(200);
  });
});
