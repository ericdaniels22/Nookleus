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

import { GET, PATCH } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeClient,
  memberTables,
} from "@/lib/request-context/__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };
const getReq = () => new Request("http://test/api/qb/connection");
const patchReq = (body: unknown) =>
  new Request("http://test/api/qb/connection", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

function useUser(opts: Parameters<typeof fakeClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeClient(opts) as never,
  );
}

function useService(tables?: Record<string, Record<string, unknown>[]>) {
  vi.mocked(createServiceClient).mockReturnValue(
    fakeClient({ tables }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// `requireAdmin` retired — the route now carries `{ adminOnly: true }`, so
// only the admin role passes; a permission grant never substitutes.
describe("GET /api/qb/connection (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    useService();
    const res = await GET(getReq(), noParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-admin even with accounting permissions", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({
        userId: "u-1",
        role: "member",
        grants: ["view_accounting", "manage_accounting"],
      }),
    });
    useService();
    const res = await GET(getReq(), noParams);
    expect(res.status).toBe(403);
  });

  it("returns 200 for an admin and reports no active connection", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "admin" }),
    });
    useService({ qb_connection: [] });
    const res = await GET(getReq(), noParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });
  });
});

describe("PATCH /api/qb/connection (converted to withRequestContext)", () => {
  it("returns 403 for a non-admin", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "member" }),
    });
    useService();
    const res = await PATCH(patchReq({}), noParams);
    expect(res.status).toBe(403);
  });

  it("reaches the handler for an admin (404 when no connection exists)", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "admin" }),
    });
    useService({ qb_connection: [] });
    const res = await PATCH(patchReq({}), noParams);
    expect(res.status).toBe(404);
  });
});
