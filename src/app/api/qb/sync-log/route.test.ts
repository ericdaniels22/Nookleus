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
const req = () => new Request("http://test/api/qb/sync-log");

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

// `requirePermission(_, "manage_accounting")` retired — sync-log is the qb
// route that carries a permission rule rather than `{ adminOnly: true }`.
describe("GET /api/qb/sync-log (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    useService();
    const res = await GET(req(), noParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 when a member lacks manage_accounting", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "member", grants: [] }),
    });
    useService();
    const res = await GET(req(), noParams);
    expect(res.status).toBe(403);
  });

  it("returns 200 for a member holding manage_accounting", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({
        userId: "u-1",
        role: "member",
        grants: ["manage_accounting"],
      }),
    });
    useService({ qb_sync_log: [] });
    const res = await GET(req(), noParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ rows: [], total: 0 });
  });

  it("returns 200 for an admin without the permission key", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "admin", grants: [] }),
    });
    useService({ qb_sync_log: [] });
    const res = await GET(req(), noParams);
    expect(res.status).toBe(200);
  });
});
