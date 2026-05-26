// GET + POST /api/referral-partners/[id]/calls — the Call log endpoints
// (PRD #249, issue #254). GET returns the partner's call history in
// chronological-newest-first order; POST inserts a new
// `referral_partner_calls` row scoped to the Active Organization with
// `user_id` from the request context and immediately recomputes the
// partner's denormalized `last_called_at` / `last_call_outcome` /
// `next_follow_up_at` columns. Gated on EDIT_REFERRAL_PARTNERS — a
// crew_member cannot read or write the log.

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

function getReq() {
  return new Request("http://test/api/referral-partners/p-1/calls");
}

function postReq(body: unknown) {
  return new Request("http://test/api/referral-partners/p-1/calls", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("GET /api/referral-partners/[id]/calls — auth + permission", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await GET(getReq(), PARAMS);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a crew_member — call history is gated", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member" }),
    });
    const res = await GET(getReq(), PARAMS);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/referral-partners/[id]/calls — read", () => {
  it("returns the call log for the partner (admin)", async () => {
    const callRows = [
      {
        id: "call-1",
        organization_id: "org-1",
        referral_partner_id: "p-1",
        outcome: "spoke",
        notes: "Asked about pricing",
        called_at: "2026-05-10T12:00:00Z",
        follow_up_at: null,
        user_id: "user-1",
        referral_contact_id: null,
      },
    ];
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partner_calls: callRows,
      },
    });
    const res = await GET(getReq(), PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calls).toEqual(callRows);
  });

  it("a crew_lead can read the call log", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "crew_lead" }),
        referral_partner_calls: [],
      },
    });
    const res = await GET(getReq(), PARAMS);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/referral-partners/[id]/calls — auth + permission", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await POST(postReq({ outcome: "spoke" }), PARAMS);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a crew_member", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member" }),
    });
    const res = await POST(postReq({ outcome: "spoke" }), PARAMS);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/referral-partners/[id]/calls — validation", () => {
  it("rejects an unknown outcome with 400", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "admin" }),
    });
    const res = await POST(postReq({ outcome: "yelled_at" }), PARAMS);
    expect(res.status).toBe(400);
  });

  it("rejects a body with no outcome with 400", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "admin" }),
    });
    const res = await POST(postReq({ notes: "no outcome here" }), PARAMS);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/referral-partners/[id]/calls — happy path", () => {
  it("a crew_lead can log a call; the new row is returned with status 201", async () => {
    const seededCall = {
      id: "call-new",
      organization_id: "org-1",
      referral_partner_id: "p-1",
      user_id: "user-1",
      outcome: "spoke",
      notes: "Will call back next week",
      called_at: "2026-05-15T10:00:00Z",
      follow_up_at: "2026-05-22T15:00:00Z",
      referral_contact_id: null,
    };
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "crew_lead" }),
        referral_partners: [
          { id: "p-1", organization_id: "org-1", company_name: "Acme" },
        ],
        referral_partner_calls: [seededCall],
      },
    });
    const res = await POST(
      postReq({
        outcome: "spoke",
        notes: "Will call back next week",
        follow_up_at: "2026-05-22T15:00:00Z",
        referral_contact_id: null,
      }),
      PARAMS,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.call.outcome).toBe("spoke");
    expect(body.call.referral_partner_id).toBe("p-1");
  });
});
