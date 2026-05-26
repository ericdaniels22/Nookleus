import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { GET, POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../__test-utils__/request-context-fakes";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function postBody(body: unknown) {
  return new Request("http://test/api/referral-partners", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("GET /api/referral-partners", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await GET(new Request("http://test/api/referral-partners"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a crew_member — fee/lifecycle data is gated", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member" }),
    });
    const res = await GET(new Request("http://test/api/referral-partners"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(403);
  });

  it("returns the list of partners for an admin", async () => {
    const partner = {
      id: "p-1",
      organization_id: "org-1",
      company_name: "Acme Plumbing",
      status: "grey",
    };
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [partner],
      },
    });
    const res = await GET(new Request("http://test/api/referral-partners"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.referral_partners).toEqual([partner]);
  });

  it("returns the list of partners for a crew_lead", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "crew_lead" }),
        referral_partners: [],
      },
    });
    const res = await GET(new Request("http://test/api/referral-partners"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/referral-partners", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await POST(postBody({ company_name: "X" }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a crew_member", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member" }),
    });
    const res = await POST(postBody({ company_name: "X" }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a body with no company_name with 400", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "admin" }),
    });
    const res = await POST(postBody({ company_name: "  " }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(400);
  });

  it("a crew_lead can create a Target — the row is returned with status grey", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "crew_lead" }),
        // Seed the inserted-and-read-back row; the fake's insert() is a
        // passthrough so single() returns whatever is on the table fixture.
        referral_partners: [
          {
            id: "p-new",
            organization_id: "org-1",
            company_name: "Acme Plumbing",
            status: "grey",
            office_phone: null,
            lead_source: null,
            industry: null,
            notes: null,
          },
        ],
      },
    });
    const res = await POST(
      postBody({
        company_name: "Acme Plumbing",
        office_phone: "",
        lead_source: "",
        industry: "",
        notes: "",
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.referral_partner.status).toBe("grey");
    expect(body.referral_partner.company_name).toBe("Acme Plumbing");
  });
});
