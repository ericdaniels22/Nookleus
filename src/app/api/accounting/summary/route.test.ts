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
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeClient,
  memberTables,
} from "@/lib/request-context/__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };
const req = () => new Request("http://test/api/accounting/summary");

function useUser(opts: Parameters<typeof fakeClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeClient(opts) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// `requireViewAccounting` retired — the route now carries the rule
// `{ permission: "view_accounting" }`, so admins and view_accounting
// holders pass and everyone else gets the wrapper's standardized 403.
describe("GET /api/accounting/summary (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await GET(req(), noParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 when a member lacks view_accounting", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "member", grants: [] }),
    });
    const res = await GET(req(), noParams);
    expect(res.status).toBe(403);
  });

  it("returns 200 for a member holding view_accounting", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({
        userId: "u-1",
        role: "member",
        grants: ["view_accounting"],
      }),
    });
    const res = await GET(req(), noParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("revenue");
    expect(body).toHaveProperty("outstandingAR");
  });

  it("returns 200 for an admin without the permission key", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "admin", grants: [] }),
    });
    const res = await GET(req(), noParams);
    expect(res.status).toBe(200);
  });
});
