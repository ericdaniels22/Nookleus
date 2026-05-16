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
import {
  fakeUserClient,
  fakeServiceClient,
  memberTables,
  type ServiceFake,
} from "./__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

const validBody = {
  job_id: "job-1",
  vendor_id: null,
  vendor_name: "Acme Supply",
  category_id: "cat-1",
  amount: 125.5,
  expense_date: "2026-05-16",
  payment_method: "business_card",
  description: null,
  receipt_path: null,
  thumbnail_path: null,
};

function postRequest(body: unknown) {
  return new Request("http://test/api/expenses", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function useServiceFake(rpcResults?: Record<string, { data?: unknown }>): ServiceFake {
  const service = fakeServiceClient({ rpcResults });
  vi.mocked(createServiceClient).mockReturnValue(service.client as never);
  return service;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("POST /api/expenses (converted to withRequestContext)", () => {
  it("returns 401 and never reaches the create RPC when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const service = useServiceFake();

    const res = await POST(postRequest(validBody), noParams);

    expect(res.status).toBe(401);
    expect(service.rpcCalls).toHaveLength(0);
  });

  it("returns 403 when a non-admin lacks the log_expenses permission", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );
    const service = useServiceFake();

    const res = await POST(postRequest(validBody), noParams);

    expect(res.status).toBe(403);
    expect(service.rpcCalls).toHaveLength(0);
  });

  it("returns 403 'Profile not found' when the caller has no user_profiles row", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "admin", profile: null }),
      }) as never,
    );
    const service = useServiceFake();

    const res = await POST(postRequest(validBody), noParams);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Profile not found" });
    expect(service.rpcCalls).toHaveLength(0);
  });

  it("returns 400 when required fields are missing", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          profile: { full_name: "Dana Lee" },
        }),
      }) as never,
    );
    const service = useServiceFake();

    const res = await POST(postRequest({ ...validBody, job_id: "" }), noParams);

    expect(res.status).toBe(400);
    expect(service.rpcCalls).toHaveLength(0);
  });

  it("creates the expense, passing the caller's id and full_name to the RPC", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["log_expenses"],
          profile: { full_name: "Dana Lee" },
        }),
      }) as never,
    );
    const service = useServiceFake({
      create_expense_with_activity: { data: "expense-9" },
    });

    const res = await POST(postRequest(validBody), noParams);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "expense-9" });
    expect(service.rpcCalls).toHaveLength(1);
    expect(service.rpcCalls[0].name).toBe("create_expense_with_activity");
    expect(service.rpcCalls[0].args).toMatchObject({
      p_submitted_by: "user-1",
      p_submitter_name: "Dana Lee",
      p_job_id: "job-1",
    });
  });
});
