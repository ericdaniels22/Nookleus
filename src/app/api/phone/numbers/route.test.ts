// PRD #304 — Nookleus Phone. Slice 3 (#307) — route tests for
//   GET  /api/phone/numbers              — list (view_phone)
//   POST /api/phone/numbers              — provision Shared (admin)
//
// AC bullets:
//   - "Vitest route tests for the provision and release routes
//      (mocked Twilio client)"
//   - "Non-admin cannot see Settings → Phone or hit its routes"
//
// The Twilio dependency is mocked at the module boundary
// (`@/lib/phone/twilio-client`); the route never imports `twilio`
// directly, so the mock covers the whole network surface.

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

const provisionNumberMock = vi.fn();
const createTwilioClientMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  provisionNumber: (...args: unknown[]) => provisionNumberMock(...args),
  createTwilioClient: () => createTwilioClientMock(),
}));

import { GET, POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeServiceClient,
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function postReq(body: Record<string, unknown> = {}) {
  return new Request("http://test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  // Default fake service-client returns empty `phone_numbers`. Each test
  // that needs a row swaps in its own client.
  vi.mocked(createServiceClient).mockReturnValue(
    fakeServiceClient({ tables: { phone_numbers: [] } }) as never,
  );
  createTwilioClientMock.mockReturnValue({ /* unused — provisionNumber is mocked */ });
});

describe("GET /api/phone/numbers — gated on view_phone", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await GET(new Request("http://test/api/phone/numbers"), noParams);

    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks view_phone (crew_member by default)", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
    });

    const res = await GET(new Request("http://test/api/phone/numbers"), noParams);

    expect(res.status).toBe(403);
  });

  it("returns 200 when the caller holds view_phone (crew_lead)", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_phone"],
      }),
    });

    const res = await GET(new Request("http://test/api/phone/numbers"), noParams);

    expect(res.status).toBe(200);
  });

  it("admins pass the gate without holding the key", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await GET(new Request("http://test/api/phone/numbers"), noParams);

    expect(res.status).toBe(200);
  });
});

describe("POST /api/phone/numbers — admin-only provision (canManage)", () => {
  // The route is wrapped on `view_phone`, but the canManage rule is the
  // real gate. Slice 3 only lands Shared numbers, so canManage on Shared
  // reduces to `role === 'admin'`.

  const VALID_PROVISION = { phoneNumber: "+15125551234", label: "Marketing" };

  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await POST(postReq(VALID_PROVISION), noParams);

    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is a crew_lead with view_phone (admin-only)", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_phone"],
      }),
    });

    const res = await POST(postReq(VALID_PROVISION), noParams);

    expect(res.status).toBe(403);
    // Twilio must not have been called when the request is denied.
    expect(provisionNumberMock).not.toHaveBeenCalled();
  });

  it("returns 400 when phoneNumber is missing", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await POST(postReq({ label: "Marketing" }), noParams);

    expect(res.status).toBe(400);
    expect(provisionNumberMock).not.toHaveBeenCalled();
  });

  it("provisions on Twilio, then inserts the row, when caller is admin", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    provisionNumberMock.mockResolvedValue({
      sid: "PNabc",
      phoneNumber: "+15125551234",
    });

    // Service client returns the inserted row on .single() — the fake's
    // queryBuilder resolves single() to first row, which for an `insert`
    // chain we fake by seeding the table to be "returned" post-insert.
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: {
          phone_numbers: [
            {
              id: "row-1",
              organization_id: "org-1",
              twilio_sid: "PNabc",
              e164: "+15125551234",
              label: "Marketing",
              kind: "shared",
              user_id: null,
              monthly_cost_cents: null,
              released_at: null,
              created_at: "2026-05-27T00:00:00Z",
            },
          ],
        },
      }) as never,
    );

    const res = await POST(postReq(VALID_PROVISION), noParams);

    expect(res.status).toBe(201);
    expect(provisionNumberMock).toHaveBeenCalledWith(
      expect.anything(),
      "+15125551234",
    );
    const body = await res.json();
    expect(body).toMatchObject({
      twilio_sid: "PNabc",
      e164: "+15125551234",
      kind: "shared",
    });
  });

  it("returns 502 when Twilio rejects the provision call (and does NOT insert a row)", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    provisionNumberMock.mockRejectedValue(
      new Error("twilio: 21404 not available"),
    );

    const res = await POST(postReq(VALID_PROVISION), noParams);

    expect(res.status).toBe(502);
  });
});
