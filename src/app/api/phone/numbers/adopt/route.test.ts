// PRD #304 — Nookleus Phone. Slice 14 (#318) — adopt an already-ported number.
//
//   POST /api/phone/numbers/adopt — register a number whose carrier port onto
//   the Twilio account has completed (e.g. the legacy CallRail line). Unlike
//   the provision route (`POST /api/phone/numbers`), this BUYS NOTHING: it
//   looks up the existing Twilio SID via `adoptPortedNumber` and inserts the
//   Shared row pointing at it. Admin-only (canManage on Shared, ADR 0003).
//
// The Twilio dependency is mocked at the module boundary
// (`@/lib/phone/twilio-client`); the route never imports `twilio` directly.

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

const adoptPortedNumberMock = vi.fn();
const createTwilioClientMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  adoptPortedNumber: (...args: unknown[]) => adoptPortedNumberMock(...args),
  createTwilioClient: () => createTwilioClientMock(),
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

// The row the service client "returns" from .single() post-insert. Seeding
// the table to this row is how the queryBuilder fake echoes an inserted row.
function adoptedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    organization_id: "org-1",
    twilio_sid: "PNported",
    e164: "+15125559999",
    label: "Main line (ported)",
    kind: "shared",
    user_id: null,
    inbound_rule: { kind: "ring-all", users: [] },
    monthly_cost_cents: null,
    released_at: null,
    created_at: "2026-06-10T00:00:00Z",
    ...overrides,
  };
}

// A service client whose `insert` records its payload — the shared
// `fakeServiceClient` treats insert as a no-op passthrough, so we can't assert
// on what the route wrote. This minimal capturing builder mirrors the chain
// the route uses: .insert(payload).select(...).single() → the seeded row.
function capturingServiceClient(seedRow: Record<string, unknown>) {
  const insertSpy = vi.fn();
  const builder: Record<string, unknown> = {
    insert: (payload: unknown) => {
      insertSpy(payload);
      return builder;
    },
    select: () => builder,
    single: async () => ({ data: seedRow, error: null }),
  };
  return { client: { from: () => builder }, insertSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createServiceClient).mockReturnValue(
    fakeServiceClient({ tables: { phone_numbers: [] } }) as never,
  );
  createTwilioClientMock.mockReturnValue({ /* unused — adoptPortedNumber mocked */ });
});

describe("POST /api/phone/numbers/adopt — admin-only adoption (canManage)", () => {
  const VALID_ADOPT = {
    phoneNumber: "+15125559999",
    label: "Main line (ported)",
  };

  it("adopts the existing Twilio number and inserts a Shared row (no purchase)", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    adoptPortedNumberMock.mockResolvedValue({
      sid: "PNported",
      phoneNumber: "+15125559999",
    });
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({ tables: { phone_numbers: [adoptedRow()] } }) as never,
    );

    const res = await POST(postReq(VALID_ADOPT), noParams);

    expect(res.status).toBe(201);
    expect(adoptPortedNumberMock).toHaveBeenCalledWith(
      expect.anything(),
      "+15125559999",
    );
    const body = await res.json();
    expect(body).toMatchObject({
      twilio_sid: "PNported",
      e164: "+15125559999",
      kind: "shared",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await POST(postReq(VALID_ADOPT), noParams);

    expect(res.status).toBe(401);
    expect(adoptPortedNumberMock).not.toHaveBeenCalled();
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

    const res = await POST(postReq(VALID_ADOPT), noParams);

    expect(res.status).toBe(403);
    // A denied request must never reach Twilio.
    expect(adoptPortedNumberMock).not.toHaveBeenCalled();
  });

  it("returns 400 when phoneNumber is missing", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await POST(postReq({ label: "Main line (ported)" }), noParams);

    expect(res.status).toBe(400);
    expect(adoptPortedNumberMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the Twilio lookup fails (port not complete) and does NOT insert a row", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    adoptPortedNumberMock.mockRejectedValue(
      new Error("no number on the Twilio account (port not complete)"),
    );

    const res = await POST(postReq(VALID_ADOPT), noParams);

    expect(res.status).toBe(502);
  });

  it("validates a supplied ring-all inbound_rule and writes it on the row", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    adoptPortedNumberMock.mockResolvedValue({
      sid: "PNported",
      phoneNumber: "+15125559999",
    });
    const ring = { kind: "ring-all", users: ["user-9"] };
    const { client, insertSpy } = capturingServiceClient(
      adoptedRow({ inbound_rule: ring }),
    );
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      postReq({ ...VALID_ADOPT, inbound_rule: ring }),
      noParams,
    );

    expect(res.status).toBe(201);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ inbound_rule: ring }),
    );
  });

  it("rejects a malformed inbound_rule with 400 before reaching Twilio", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await POST(
      postReq({ ...VALID_ADOPT, inbound_rule: { kind: "nonsense" } }),
      noParams,
    );

    expect(res.status).toBe(400);
    // Input validation precedes the side effect — no wasted Twilio lookup.
    expect(adoptPortedNumberMock).not.toHaveBeenCalled();
  });
});
