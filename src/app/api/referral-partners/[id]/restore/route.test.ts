// POST /api/referral-partners/[id]/restore — restore a soft-deleted Referral
// Partner. Permission gate + happy path coverage.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

const PARAMS = { params: Promise.resolve({ id: "p-1" }) };
const REQ = new Request("http://test/api/referral-partners/p-1/restore", {
  method: "POST",
});

describe("POST /api/referral-partners/[id]/restore — auth + permission", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await POST(REQ, PARAMS);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a crew_member", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member" }),
    });
    const res = await POST(REQ, PARAMS);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/referral-partners/[id]/restore — happy path", () => {
  it("an admin can restore a trashed partner", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [
          {
            id: "p-1",
            organization_id: "org-1",
            company_name: "Acme",
            deleted_at: "2026-05-01T00:00:00.000Z",
          },
        ],
      },
    });
    const res = await POST(REQ, PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 404 when no matching trashed row exists", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [],
      },
    });
    const res = await POST(REQ, PARAMS);
    expect(res.status).toBe(404);
  });
});
