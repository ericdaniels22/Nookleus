// POST /api/referral-partners/[id]/delete — soft-delete a Referral Partner.
// Tests cover the EDIT_REFERRAL_PARTNERS gate (admin / crew_lead) and the
// happy / not-found paths. crew_member never reaches the row.

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
const REQ = new Request("http://test/api/referral-partners/p-1/delete", {
  method: "POST",
});

describe("POST /api/referral-partners/[id]/delete — auth + permission", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await POST(REQ, PARAMS);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a crew_member — soft-delete is gated", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member" }),
    });
    const res = await POST(REQ, PARAMS);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/referral-partners/[id]/delete — happy path", () => {
  it("a crew_lead can soft-delete an active partner", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "crew_lead" }),
        referral_partners: [
          { id: "p-1", organization_id: "org-1", company_name: "Acme" },
        ],
      },
    });
    const res = await POST(REQ, PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 404 when the partner is invisible (RLS hid it)", async () => {
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
