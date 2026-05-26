// PATCH /api/referral-partners/[id] — the Call Worksheet's edit endpoint
// (PRD #249, issue #253). Edits to the editable column set listed on the
// issue plus Lifecycle status flips. Gated on EDIT_REFERRAL_PARTNERS so a
// crew_member cannot mutate even via direct API call.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { PATCH } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function patchBody(body: unknown) {
  return new Request("http://test/api/referral-partners/p-1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const PARAMS = { params: Promise.resolve({ id: "p-1" }) };

describe("PATCH /api/referral-partners/[id] — auth + permission", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await PATCH(patchBody({ status: "yellow" }), PARAMS);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a crew_member — fee/lifecycle data is gated", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member" }),
    });
    const res = await PATCH(patchBody({ status: "yellow" }), PARAMS);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/referral-partners/[id] — validation", () => {
  it("rejects an unknown Lifecycle status with 400", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [
          { id: "p-1", organization_id: "org-1", status: "grey" },
        ],
      },
    });
    const res = await PATCH(patchBody({ status: "purple" }), PARAMS);
    expect(res.status).toBe(400);
  });

  it("rejects a blank company_name with 400", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [
          { id: "p-1", organization_id: "org-1", status: "grey" },
        ],
      },
    });
    const res = await PATCH(patchBody({ company_name: "   " }), PARAMS);
    expect(res.status).toBe(400);
  });

  it("rejects a body with no editable fields with 400", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [
          { id: "p-1", organization_id: "org-1", status: "grey" },
        ],
      },
    });
    const res = await PATCH(patchBody({ id: "p-evil" }), PARAMS);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/referral-partners/[id] — happy path", () => {
  it("a crew_lead can flip Lifecycle status; the updated row is returned", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "crew_lead" }),
        // The fake's update() is a passthrough — single() returns the
        // seeded row, so we seed it with the desired post-update state.
        referral_partners: [
          {
            id: "p-1",
            organization_id: "org-1",
            company_name: "Acme Plumbing",
            status: "green",
          },
        ],
      },
    });
    const res = await PATCH(patchBody({ status: "green" }), PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.referral_partner.id).toBe("p-1");
    expect(body.referral_partner.status).toBe("green");
  });

  it("an admin can edit any whitelisted text column", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [
          {
            id: "p-1",
            organization_id: "org-1",
            company_name: "Acme",
            referral_fee_terms: "10% per closed job",
          },
        ],
      },
    });
    const res = await PATCH(
      patchBody({ referral_fee_terms: "10% per closed job" }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.referral_partner.referral_fee_terms).toBe(
      "10% per closed job",
    );
  });

  it("returns 404 when the partner id is not visible (RLS hid it) — no row to update", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [], // RLS hid every row from this caller
      },
    });
    const res = await PATCH(patchBody({ status: "green" }), PARAMS);
    expect(res.status).toBe(404);
  });
});
