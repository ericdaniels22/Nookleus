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

const params = (type: string) => ({ params: Promise.resolve({ type }) });
const req = (type: string) =>
  new Request(`http://test/api/accounting/export/${type}`);

function useUser(opts: Parameters<typeof fakeClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeClient(opts) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// The dynamic export route — proves the converted wrapper passes the
// Next.js route params (`{ type }`) through to the handler untouched.
describe("GET /api/accounting/export/[type] (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await GET(req("ar-aging"), params("ar-aging"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when a member lacks view_accounting", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "member", grants: [] }),
    });
    const res = await GET(req("ar-aging"), params("ar-aging"));
    expect(res.status).toBe(403);
  });

  it("streams a CSV for an authorized caller", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "admin", grants: [] }),
    });
    const res = await GET(req("ar-aging"), params("ar-aging"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("reaches the handler's 400 for an unknown export type", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({
        userId: "u-1",
        role: "member",
        grants: ["view_accounting"],
      }),
    });
    const res = await GET(req("bogus"), params("bogus"));
    expect(res.status).toBe(400);
  });
});
