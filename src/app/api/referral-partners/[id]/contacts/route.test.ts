// POST /api/referral-partners/[id]/contacts — inline + Add contact endpoint
// (PRD #249, issue #255). Creates a `contacts` row with
// role = 'referral_contact' and referral_partner_id set to the partner the
// Worksheet is open on. Gated on EDIT_REFERRAL_PARTNERS — a crew_member
// cannot add Referral Contacts.

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

function postReq(body: unknown) {
  return new Request("http://test/api/referral-partners/p-1/contacts", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/referral-partners/[id]/contacts — auth + permission", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await POST(postReq({ full_name: "Pat" }), PARAMS);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a crew_member — gated on EDIT_REFERRAL_PARTNERS", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member" }),
    });
    const res = await POST(postReq({ full_name: "Pat" }), PARAMS);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/referral-partners/[id]/contacts — validation", () => {
  it("rejects a body with no full_name with 400", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "admin" }),
    });
    const res = await POST(postReq({ phone: "555-1234" }), PARAMS);
    expect(res.status).toBe(400);
  });

  it("rejects a blank full_name with 400", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "admin" }),
    });
    const res = await POST(postReq({ full_name: "   " }), PARAMS);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/referral-partners/[id]/contacts — happy path", () => {
  it("a crew_lead can add a Referral Contact; the new row is returned with status 201", async () => {
    const seededContact = {
      id: "c-new",
      organization_id: "org-1",
      referral_partner_id: "p-1",
      full_name: "Pat Smith",
      phone: "5551234567",
      email: "pat@acme.test",
      role: "referral_contact",
      notes: null,
    };
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "crew_lead" }),
        contacts: [seededContact],
      },
    });
    const res = await POST(
      postReq({
        full_name: "Pat Smith",
        phone: "5551234567",
        email: "pat@acme.test",
        notes: "",
      }),
      PARAMS,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.contact.full_name).toBe("Pat Smith");
    expect(body.contact.role).toBe("referral_contact");
    expect(body.contact.referral_partner_id).toBe("p-1");
  });
});
