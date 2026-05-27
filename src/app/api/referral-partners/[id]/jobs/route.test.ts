// GET /api/referral-partners/[id]/jobs — slice C2 (#301).
//
// Returns the Jobs attributed to a Referral Partner, newest first by intake
// date, excluding trashed Jobs. The Worksheet's "Jobs sent" section is a
// thin renderer over this response. Gated on VIEW_REFERRAL_PARTNERS — the
// same rule the Worksheet page itself uses.
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

describe("GET /api/referral-partners/[id]/jobs — auth + permission", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await GET(
      new Request("http://test/api/referral-partners/p-1/jobs"),
      PARAMS,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for a crew_member — Referral Partners are a gated surface", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "crew_member" }),
    });
    const res = await GET(
      new Request("http://test/api/referral-partners/p-1/jobs"),
      PARAMS,
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/referral-partners/[id]/jobs — Organization scoping", () => {
  it("returns 404 when the partner id is not visible to this caller (RLS hid it / cross-org)", async () => {
    useUser({
      user: { id: "u-1" },
      tables: {
        ...memberTables({ userId: "u-1", role: "admin" }),
        referral_partners: [], // RLS hides cross-org rows from the User client.
      },
    });
    const res = await GET(
      new Request("http://test/api/referral-partners/p-1/jobs"),
      PARAMS,
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/referral-partners/[id]/jobs — response shape", () => {
  it("returns each attributed Job with id, property_address, status, and created_at", async () => {
    useUser({
      user: { id: "u-1" },
      tables: {
        ...memberTables({ userId: "u-1", role: "admin" }),
        referral_partners: [{ id: "p-1", organization_id: "org-1" }],
        jobs: [
          {
            id: "j-1",
            referral_partner_id: "p-1",
            deleted_at: null,
            property_address: "123 Main St",
            status: "lead",
            created_at: "2026-05-01T00:00:00Z",
          },
        ],
      },
    });
    const res = await GET(
      new Request("http://test/api/referral-partners/p-1/jobs"),
      PARAMS,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs).toEqual([
      {
        id: "j-1",
        property_address: "123 Main St",
        status: "lead",
        created_at: "2026-05-01T00:00:00Z",
      },
    ]);
  });

  // AC #7 — link-preservation behaviour from slice B. A trashed Partner
  // inside the 30-day grace period still has a Worksheet, and the
  // Worksheet's Jobs sent section still resolves against the API.
  it("still returns jobs when the Partner is trashed (30-day grace period)", async () => {
    useUser({
      user: { id: "u-1" },
      tables: {
        ...memberTables({ userId: "u-1", role: "admin" }),
        referral_partners: [
          {
            id: "p-1",
            organization_id: "org-1",
            deleted_at: "2026-05-10T00:00:00Z", // trashed
          },
        ],
        jobs: [
          {
            id: "j-1",
            referral_partner_id: "p-1",
            deleted_at: null,
            property_address: "100 Trashed Partner Way",
            status: "lead",
            created_at: "2026-04-01T00:00:00Z",
          },
        ],
      },
    });
    const res = await GET(
      new Request("http://test/api/referral-partners/p-1/jobs"),
      PARAMS,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].id).toBe("j-1");
  });
});
