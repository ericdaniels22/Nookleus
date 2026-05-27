// PRD #304 — Nookleus Phone. Slice 5 (#309).
//
// POST /api/phone/opt-outs/[id]/re-opt-in — admin-only.
//
// AC: "An admin can mark a number as re-opted-in (after fresh consent)" —
// writes `re_opted_in_at`, `re_opted_in_note`, `re_opted_in_by_user_id`.
// A non-admin must not be able to flip the gate.

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
  fakeServiceClient,
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function postReq(body: Record<string, unknown>) {
  return new Request("http://test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createServiceClient).mockReturnValue(
    fakeServiceClient({
      tables: {
        phone_opt_outs: [
          {
            id: "oo-1",
            organization_id: "org-1",
            outside_e164: "+15551112222",
            re_opted_in_at: null,
          },
        ],
      },
    }) as never,
  );
});

describe("POST /api/phone/opt-outs/[id]/re-opt-in — admin-only", () => {
  it("returns 401 unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const res = await POST(postReq({ note: "ok" }), params("oo-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is a crew_lead (admin-only)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({
          userId: "u-1",
          role: "crew_lead",
          grants: ["view_phone"],
        }),
      }) as never,
    );
    const res = await POST(postReq({ note: "ok" }), params("oo-1"));
    expect(res.status).toBe(403);
  });

  it("returns 400 when note is missing or empty", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "admin-1" },
        tables: memberTables({
          userId: "admin-1",
          role: "admin",
          grants: [],
        }),
      }) as never,
    );
    const res = await POST(postReq({}), params("oo-1"));
    expect(res.status).toBe(400);
  });

  it("flips the row's re_opted_in_at and records note + admin id", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "admin-1" },
        tables: memberTables({
          userId: "admin-1",
          role: "admin",
          grants: [],
        }),
      }) as never,
    );

    const res = await POST(
      postReq({ note: "fresh consent confirmed by phone" }),
      params("oo-1"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 404 when the opt-out row is not in the active org", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "admin-1" },
        tables: memberTables({
          userId: "admin-1",
          role: "admin",
          grants: [],
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: {
          phone_opt_outs: [
            {
              id: "oo-foreign",
              organization_id: "other-org",
              outside_e164: "+15551112222",
              re_opted_in_at: null,
            },
          ],
        },
      }) as never,
    );

    const res = await POST(postReq({ note: "ok" }), params("oo-foreign"));
    expect(res.status).toBe(404);
  });
});
