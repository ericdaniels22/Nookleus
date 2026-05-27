// PRD #304 — Nookleus Phone. Slice 5 (#309).
//
// Tests for the outbound-SMS send route. AC bullets covered:
//   - "Outbound send route: a Crew Lead can send a text to a customer;
//      Twilio delivers it; phone_messages row exists with the right
//      direction, body, from_e164, to_e164"
//   - "Outbound send route returns an error when the recipient is in
//      phone_opt_outs (no Twilio call made)"
//   - "Vitest route tests: outbound send route (signature, opt-out gate,
//      Twilio dispatch — mocked), ..."
//
// Route shape:
//   POST /api/phone/messages
//   body: {
//     conversationId?: string,         // existing thread
//     outsideE164?: string,            // first message in a new thread
//     body: string,
//     sourceContext?: 'phone-tab' | 'contact-card' | { kind: 'job', jobId }
//   }
//
// view_phone gate; Twilio is mocked at the module boundary. The pure
// modules (`opt-out-registry`, `select-outbound-number`, `smart-attach`)
// run for real — they're cheap and the route is mostly composition over
// them.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

const sendSmsMock = vi.fn();
const createTwilioClientMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  sendSms: (...args: unknown[]) => sendSmsMock(...args),
  createTwilioClient: () => createTwilioClientMock(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { fakeUserClient, memberTables } from "@/app/api/email/__test-utils__/request-context-fakes";

type Row = Record<string, unknown>;

// A small Supabase service-client fake that records every insert / upsert /
// update so tests can assert on them. Mirrors the fake in
// `src/app/api/phone/webhook/sms-inbound/route.test.ts`. Only the surface
// the route actually touches is implemented.
function makeServiceClient(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {
    phone_numbers: [],
    phone_opt_outs: [],
    phone_conversations: [],
    phone_messages: [],
    ...seed,
  };
  const inserts: { table: string; row: Row }[] = [];
  const upserts: { table: string; row: Row; onConflict?: string }[] = [];
  const updates: { table: string; patch: Row; filters: Row }[] = [];

  function builder(table: string) {
    let rows = tables[table] ?? [];
    const ctx: { filters: Row } = { filters: {} };
    let pendingInsert: Row | null = null;
    let pendingUpdate: Row | null = null;

    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.order = () => b;
    b.limit = () => b;
    b.eq = (col: string, val: unknown) => {
      ctx.filters[col] = val;
      rows = rows.filter((r) => r[col] === val);
      return b;
    };
    b.in = (col: string, vals: unknown[]) => {
      rows = rows.filter((r) => vals.includes(r[col] as unknown));
      return b;
    };
    b.is = (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] === val);
      return b;
    };
    b.insert = (row: Row) => {
      pendingInsert = row;
      inserts.push({ table, row });
      return b;
    };
    b.upsert = (row: Row, opts?: { onConflict?: string }) => {
      pendingInsert = row;
      upserts.push({ table, row, onConflict: opts?.onConflict });
      return b;
    };
    b.update = (patch: Row) => {
      pendingUpdate = patch;
      return b;
    };
    b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    b.single = async () => {
      if (pendingInsert) {
        const row: Row = { id: `new-${inserts.length + upserts.length}`, ...pendingInsert };
        tables[table].push(row);
        return { data: row, error: null };
      }
      return {
        data: rows[0] ?? null,
        error: rows[0] ? null : { message: "no rows" },
      };
    };
    b.then = (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      if (pendingUpdate) {
        updates.push({ table, patch: pendingUpdate, filters: { ...ctx.filters } });
        return resolve({ data: [], error: null });
      }
      return resolve({ data: rows, error: null });
    };
    return b;
  }

  return {
    client: { from: builder },
    tables,
    inserts,
    upserts,
    updates,
  };
}

function authed(userId: string, role: "admin" | "crew_lead" | "crew_member") {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: { id: userId },
      tables: memberTables({
        userId,
        role,
        grants: role === "crew_member" ? [] : ["view_phone"],
      }),
    }) as never,
  );
}

function sendReq(body: Record<string, unknown>) {
  return new Request("http://test/api/phone/messages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const noParams = { params: Promise.resolve({}) };

const ORG = "org-1";
const SHARED_NUM_ROW = {
  id: "num-shared",
  organization_id: ORG,
  twilio_sid: "PNshared",
  e164: "+15125550000",
  kind: "shared",
  user_id: null,
  released_at: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue(ORG);
  createTwilioClientMock.mockReturnValue({});
  sendSmsMock.mockResolvedValue({ sid: "SM-out", status: "queued" });
  // #309 ships behind a feature flag pending #305 (A2P 10DLC). Tests
  // exercise the route under the "flag ON" assumption; the flag-OFF
  // behaviour gets its own dedicated test block below.
  vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// 0. Feature flag (NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED).
//
// #309 is blocked by #305 (A2P 10DLC carrier registration). The PRD
// permits shipping behind a feature flag; the route must 503 with a
// clear message when the flag is off so the UI knows to hide.
// ---------------------------------------------------------------------------

describe("POST /api/phone/messages — feature flag", () => {
  it("returns 503 when NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED is not 'true'", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", body: "hi" }),
      noParams,
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/A2P|10DLC|registration|not.*available/i);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 1. Permission gate
// ---------------------------------------------------------------------------

describe("POST /api/phone/messages — view_phone gate", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const { client } = makeServiceClient({});
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", body: "hi" }),
      noParams,
    );

    expect(res.status).toBe(401);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("returns 403 when caller lacks view_phone (crew_member)", async () => {
    authed("user-cm", "crew_member");
    const { client } = makeServiceClient({});
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", body: "hi" }),
      noParams,
    );

    expect(res.status).toBe(403);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Body validation
// ---------------------------------------------------------------------------

describe("POST /api/phone/messages — body validation", () => {
  it("returns 400 when body is missing", async () => {
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567" }),
      noParams,
    );

    expect(res.status).toBe(400);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("returns 400 when neither conversationId nor outsideE164 is provided", async () => {
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(sendReq({ body: "hi" }), noParams);

    expect(res.status).toBe(400);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("returns 400 when outsideE164 is not a valid E.164", async () => {
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "555 not a phone", body: "hi" }),
      noParams,
    );

    expect(res.status).toBe(400);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Outbound-number selection
// ---------------------------------------------------------------------------

describe("POST /api/phone/messages — outbound-number selection", () => {
  it("returns 422 when the org has no eligible outbound number", async () => {
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({ phone_numbers: [] });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", body: "hi" }),
      noParams,
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/no.*number/i);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("picks the org's Shared number when no Personal is available", async () => {
    authed("user-1", "crew_lead");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", body: "hi from nookleus" }),
      noParams,
    );

    expect(res.status).toBe(201);
    // Twilio called with the Shared number as `from`.
    expect(sendSmsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        from: "+15125550000",
        to: "+15551234567",
        body: "hi from nookleus",
      }),
    );
    // A phone_messages row was inserted with direction:'out'.
    const msgInsert = inserts.find((i) => i.table === "phone_messages");
    expect(msgInsert?.row).toMatchObject({
      direction: "out",
      from_e164: "+15125550000",
      to_e164: "+15551234567",
      body: "hi from nookleus",
      twilio_sid: "SM-out",
      status: "queued",
      sent_by_user_id: "user-1",
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Opt-out gate (TCPA — the linchpin of this slice)
// ---------------------------------------------------------------------------

describe("POST /api/phone/messages — TCPA opt-out gate", () => {
  it("returns 403 with a clear error when the recipient is opted out", async () => {
    authed("user-1", "crew_lead");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      phone_opt_outs: [
        {
          id: "oo-1",
          organization_id: ORG,
          outside_e164: "+15551234567",
          opted_out_at: "2026-05-26T00:00:00Z",
          re_opted_in_at: null,
        },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", body: "hi" }),
      noParams,
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/opt(ed|-)?\s*-?\s*out/i);
    // Twilio MUST NOT have been called.
    expect(sendSmsMock).not.toHaveBeenCalled();
    // No message row written.
    expect(inserts.find((i) => i.table === "phone_messages")).toBeUndefined();
  });

  it("allows send when the customer is re-opted-in (re_opted_in_at non-null)", async () => {
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      phone_opt_outs: [
        {
          id: "oo-1",
          organization_id: ORG,
          outside_e164: "+15551234567",
          opted_out_at: "2026-05-26T00:00:00Z",
          re_opted_in_at: "2026-05-27T00:00:00Z",
          re_opted_in_note: "confirmed by phone",
        },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", body: "hi again" }),
      noParams,
    );

    expect(res.status).toBe(201);
    expect(sendSmsMock).toHaveBeenCalledOnce();
  });

  it("does not bleed opt-outs across organizations (cross-org safety)", async () => {
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      phone_opt_outs: [
        {
          id: "oo-other",
          organization_id: "other-org",
          outside_e164: "+15551234567",
          opted_out_at: "2026-05-26T00:00:00Z",
          re_opted_in_at: null,
        },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", body: "hi" }),
      noParams,
    );

    expect(res.status).toBe(201);
    expect(sendSmsMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 5. Conversation upsert + persistence
// ---------------------------------------------------------------------------

describe("POST /api/phone/messages — persistence", () => {
  it("upserts a phone_conversations row when sending to a new outside number", async () => {
    authed("user-1", "crew_lead");
    const { client, upserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    await POST(
      sendReq({ outsideE164: "+15551234567", body: "hi" }),
      noParams,
    );

    const conv = upserts.find((u) => u.table === "phone_conversations");
    expect(conv?.row).toMatchObject({
      organization_id: ORG,
      phone_number_id: "num-shared",
      outside_e164: "+15551234567",
    });
    expect(conv?.onConflict).toContain("phone_number_id");
    expect(conv?.onConflict).toContain("outside_e164");
  });

  it("returns 502 when Twilio rejects the message dispatch", async () => {
    authed("user-1", "crew_lead");
    sendSmsMock.mockRejectedValue(new Error("twilio: 21610 blocked"));
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", body: "hi" }),
      noParams,
    );

    expect(res.status).toBe(502);
    // No phone_messages row should be written when Twilio failed —
    // an unsent message that looks sent is worse than a clean retry.
    expect(inserts.find((i) => i.table === "phone_messages")).toBeUndefined();
  });
});
