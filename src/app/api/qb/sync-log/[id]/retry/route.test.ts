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
  fakeClient,
  memberTables,
} from "@/lib/request-context/__test-utils__/request-context-fakes";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () =>
  new Request("http://test/api/qb/sync-log/log-1/retry", { method: "POST" });

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

// A dynamic `{ adminOnly: true }` route — proves the converted wrapper
// passes the Next.js `{ id }` param through to the handler.
describe("POST /api/qb/sync-log/[id]/retry (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    useService();
    const res = await POST(req(), params("log-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-admin", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({
        userId: "u-1",
        role: "member",
        grants: ["manage_accounting"],
      }),
    });
    useService();
    const res = await POST(req(), params("log-1"));
    expect(res.status).toBe(403);
  });

  it("returns 200 for an admin and re-queues the row", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "admin" }),
    });
    useService({ qb_sync_log: [{ id: "log-1", status: "failed" }] });
    const res = await POST(req(), params("log-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
