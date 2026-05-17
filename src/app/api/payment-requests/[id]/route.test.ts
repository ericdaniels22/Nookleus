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

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createServiceClient).mockReturnValue(
    fakeServiceClient({
      tables: {
        payment_requests: [{ id: "pr-1", title: "Deposit", amount: 500 }],
      },
    }) as never,
  );
});

// payment-requests/[id] GET carried `requirePermission("view_billing")`;
// it now rides on the `permission` rule (admins auto-pass).
describe("GET /api/payment-requests/[id] (converted to withRequestContext, view_billing)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("pr-1"));

    expect(res.status).toBe(401);
  });

  it("returns 403 for a member who lacks view_billing", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["log_expenses"],
        }),
      }) as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("pr-1"));

    expect(res.status).toBe(403);
  });

  it("returns the payment request for a member who holds view_billing", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["view_billing"],
        }),
      }) as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("pr-1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payment_request.id).toBe("pr-1");
  });

  it("allows an admin even without the grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "admin", grants: [] }),
      }) as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("pr-1"));

    expect(res.status).toBe(200);
  });

  it("returns 404 when the payment request does not exist", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
        }),
      }) as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("does-not-exist"));

    expect(res.status).toBe(404);
  });
});
