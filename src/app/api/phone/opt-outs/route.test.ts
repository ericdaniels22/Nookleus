// PRD #304 — Nookleus Phone. Slice 5 (#309).
//
// GET /api/phone/opt-outs — list the active org's opt-out registry.
// view_phone gated; RLS does the org scoping.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { fakeUserClient, memberTables } from "@/app/api/email/__test-utils__/request-context-fakes";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/phone/opt-outs", () => {
  it("returns 401 unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const res = await GET(new Request("http://test/api/phone/opt-outs"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller lacks view_phone", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({ userId: "u-1", role: "crew_member", grants: [] }),
      }) as never,
    );
    const res = await GET(new Request("http://test/api/phone/opt-outs"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(403);
  });

  it("returns the active org's opt-out rows when caller has view_phone", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: {
          ...memberTables({
            userId: "u-1",
            role: "crew_lead",
            grants: ["view_phone"],
          }),
          phone_opt_outs: [
            {
              id: "oo-1",
              organization_id: "org-1",
              outside_e164: "+15551112222",
              opted_out_at: "2026-05-26T00:00:00Z",
              re_opted_in_at: null,
              re_opted_in_note: null,
              re_opted_in_by_user_id: null,
            },
          ],
        },
      }) as never,
    );

    const res = await GET(new Request("http://test/api/phone/opt-outs"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ outside_e164: "+15551112222" });
  });
});
