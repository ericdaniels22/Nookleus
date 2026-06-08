// PRD #304 — Nookleus Phone. Slice 8 (#312) — inbound VOICE webhook.
//
// Twilio calls this URL when a customer dials one of our numbers. The route
// is a thin shell:
//   1. Validate X-Twilio-Signature → 403 on invalid.
//   2. Parse the form-encoded payload (From, To, CallSid, CallStatus).
//   3. Look up the phone_numbers row by `To` (the org + kind + inbound_rule).
//      Unknown number → empty <Response/> (Twilio hangs up).
//   4. Thread + smart-attach via the shared `routeInbound` (Body="" — a
//      call has no body; the tag decision is body-independent).
//   5. Dial plan:
//        - Personal number → always voicemail (ADR 0005 / issue #312:
//          "voicemail is their inbound rule always").
//        - Shared number → decideShared(inbound_rule, members, cursor).
//          Members are the org roster with a cell on file; round-robin
//          persists its advanced cursor to phone_number_round_robin.
//   6. buildVoiceTwiml(decision, { callerId: <our number> }).
//   7. Write a ringing phone_calls row via ingestInboundCall.
//   8. Return 200 with the TwiML.
//
// The Twilio SDK boundary (validateTwilioSignature) and Supabase are mocked;
// the REAL buildVoiceTwiml + decideShared + routeInbound + ingestInboundCall
// run, so the TwiML and persistence are asserted end-to-end.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const validateSignatureMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/phone/twilio-client")>();
  return {
    ...actual,
    validateTwilioSignature: (...args: unknown[]) =>
      validateSignatureMock(...args),
  };
});

const createServiceClientMock = vi.fn();
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: () => createServiceClientMock(),
}));

import { POST } from "./route";

type Row = Record<string, unknown>;

interface BuilderTables {
  phone_numbers: Row[];
  contacts: Row[];
  jobs: Row[];
  user_organizations: Row[];
  phone_number_round_robin: Row[];
  phone_conversations: Row[];
  phone_calls: Row[];
}

function makeServiceClient(tables: BuilderTables) {
  const inserts: { table: string; row: Row }[] = [];
  const upserts: { table: string; row: Row; onConflict: string | undefined }[] =
    [];
  const updates: { table: string; patch: Row; filters: Row }[] = [];

  function builder(table: string) {
    let rows = (tables as unknown as Record<string, Row[]>)[table] ?? [];
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
      rows = rows.filter((r) => vals.includes(r[col]));
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
        const row = {
          id: `new-${inserts.length + upserts.length}`,
          ...pendingInsert,
        };
        (tables as unknown as Record<string, Row[]>)[table].push(row);
        return { data: row, error: null };
      }
      return {
        data: rows[0] ?? null,
        error: rows[0] ? null : { message: "no rows" },
      };
    };
    b.then = (resolve: (v: unknown) => unknown) => {
      if (pendingUpdate) {
        updates.push({ table, patch: pendingUpdate, filters: { ...ctx.filters } });
        return resolve({ data: null, error: null });
      }
      return resolve({ data: rows, error: null });
    };
    return b;
  }

  return { client: { from: builder }, inserts, upserts, updates };
}

function voiceForm(opts: {
  From?: string;
  To?: string;
  CallSid?: string;
  CallStatus?: string;
}): Request {
  const params = new URLSearchParams();
  params.set("From", opts.From ?? "+15551234567");
  params.set("To", opts.To ?? "+15125550000");
  params.set("CallSid", opts.CallSid ?? "CA-test");
  params.set("CallStatus", opts.CallStatus ?? "ringing");
  return new Request("http://test/api/phone/webhook/voice-inbound", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "valid",
    },
    body: params.toString(),
  });
}

// A Shared number whose inbound_rule rings two manually-selected members.
function ringAllTables(): BuilderTables {
  return {
    phone_numbers: [
      {
        id: "pn-1",
        organization_id: "org-1",
        e164: "+15125550000",
        kind: "shared",
        user_id: null,
        released_at: null,
        inbound_rule: { kind: "ring-all", users: ["u1", "u2"] },
      },
    ],
    contacts: [],
    jobs: [],
    user_organizations: [
      { user_id: "u1", organization_id: "org-1", user_profiles: { phone: "+15125550011" } },
      { user_id: "u2", organization_id: "org-1", user_profiles: { phone: "+15125550022" } },
      { user_id: "u3", organization_id: "org-1", user_profiles: { phone: null } },
    ],
    phone_number_round_robin: [],
    phone_conversations: [],
    phone_calls: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  validateSignatureMock.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/phone/webhook/voice-inbound — ring-all (tracer)", () => {
  it("dials every selected member's cell and writes a ringing phone_calls row", async () => {
    const { client, inserts } = makeServiceClient(ringAllTables());
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(voiceForm({ From: "+15551234567", To: "+15125550000" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/xml/);
    const xml = await res.text();
    expect(xml).toContain("<Dial");
    expect(xml).toContain("<Number>+15125550011</Number>");
    expect(xml).toContain("<Number>+15125550022</Number>");
    // The caller ID presented on the outbound legs is our Nookleus number.
    expect(xml).toContain('callerId="+15125550000"');

    const callInsert = inserts.find((i) => i.table === "phone_calls");
    expect(callInsert).toBeDefined();
    expect(callInsert!.row).toMatchObject({
      organization_id: "org-1",
      direction: "in",
      from_e164: "+15551234567",
      to_e164: "+15125550000",
      twilio_call_sid: "CA-test",
      status: "ringing",
    });
  });
});

describe("POST /api/phone/webhook/voice-inbound — signature", () => {
  it("returns 403 when the X-Twilio-Signature is missing or invalid", async () => {
    validateSignatureMock.mockReturnValue(false);
    const { client } = makeServiceClient(ringAllTables());
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(voiceForm({}));

    expect(res.status).toBe(403);
  });
});

describe("POST /api/phone/webhook/voice-inbound — round-robin", () => {
  it("dials the cursor member and persists the advanced cursor", async () => {
    const tables = ringAllTables();
    tables.phone_numbers[0].inbound_rule = {
      kind: "round-robin",
      sequence: ["u1", "u2", "u3"],
    };
    tables.user_organizations = [
      { user_id: "u1", organization_id: "org-1", user_profiles: { phone: "+15125550011" } },
      { user_id: "u2", organization_id: "org-1", user_profiles: { phone: "+15125550022" } },
      { user_id: "u3", organization_id: "org-1", user_profiles: { phone: "+15125550033" } },
    ];
    // A cursor already at 1 → this call rings the second member (u2).
    tables.phone_number_round_robin = [
      { phone_number_id: "pn-1", organization_id: "org-1", rotation_cursor: 1 },
    ];
    const { client, upserts } = makeServiceClient(tables);
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(voiceForm({}));
    const xml = await res.text();

    expect(xml).toContain("<Number>+15125550022</Number>");
    expect(xml).not.toContain("+15125550011");
    expect(xml).not.toContain("+15125550033");
    // The advanced cursor (2) is persisted for the next call.
    const rr = upserts.find((u) => u.table === "phone_number_round_robin");
    expect(rr).toBeDefined();
    expect(rr!.onConflict).toBe("phone_number_id");
    expect(rr!.row).toMatchObject({
      phone_number_id: "pn-1",
      organization_id: "org-1",
      rotation_cursor: 2,
    });
  });
});

describe("POST /api/phone/webhook/voice-inbound — forward", () => {
  it("dials only the configured forward target's cell", async () => {
    const tables = ringAllTables();
    tables.phone_numbers[0].inbound_rule = {
      kind: "forward",
      forwardUserId: "u2",
    };
    const { client } = makeServiceClient(tables);
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(voiceForm({}));
    const xml = await res.text();

    expect(xml).toContain("<Dial");
    expect(xml).toContain("<Number>+15125550022</Number>");
    expect(xml).not.toContain("+15125550011");
  });
});

describe("POST /api/phone/webhook/voice-inbound — voicemail / unconfigured", () => {
  it("routes a Shared number with NO rule (null) to voicemail and still records the call", async () => {
    const tables = ringAllTables();
    tables.phone_numbers[0].inbound_rule = null;
    const { client, inserts } = makeServiceClient(tables);
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(voiceForm({}));
    const xml = await res.text();

    expect(res.status).toBe(200);
    expect(xml).toContain("<Record");
    expect(xml).not.toContain("<Dial");
    // The inbound attempt is still persisted.
    expect(inserts.find((i) => i.table === "phone_calls")).toBeDefined();
  });
});

describe("POST /api/phone/webhook/voice-inbound — voicemail callbacks (#313)", () => {
  it("wires the voicemail-completed + transcription-completed webhook URLs from env into the <Record>", async () => {
    vi.stubEnv(
      "PHONE_VOICEMAIL_CALLBACK_URL",
      "https://app.test/api/phone/webhook/voicemail-completed",
    );
    vi.stubEnv(
      "PHONE_TRANSCRIPTION_CALLBACK_URL",
      "https://app.test/api/phone/webhook/transcription-completed",
    );
    const tables = ringAllTables();
    tables.phone_numbers[0].inbound_rule = null; // Shared, no rule → voicemail.
    const { client } = makeServiceClient(tables);
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(voiceForm({}));
    const xml = await res.text();

    expect(xml).toContain(
      'recordingStatusCallback="https://app.test/api/phone/webhook/voicemail-completed"',
    );
    expect(xml).toContain('transcribe="true"');
    expect(xml).toContain(
      'transcribeCallback="https://app.test/api/phone/webhook/transcription-completed"',
    );
  });
});

describe("POST /api/phone/webhook/voice-inbound — Personal number", () => {
  it("always routes a Personal number to voicemail, ignoring any inbound_rule", async () => {
    const tables = ringAllTables();
    // A Personal number carrying a ring-all rule that WOULD dial if honored.
    tables.phone_numbers[0].kind = "personal";
    tables.phone_numbers[0].user_id = "owner-1";
    tables.phone_numbers[0].inbound_rule = { kind: "ring-all", users: ["u1", "u2"] };
    const { client, inserts } = makeServiceClient(tables);
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(voiceForm({}));
    const xml = await res.text();

    expect(xml).toContain("<Record");
    expect(xml).not.toContain("<Dial");
    expect(inserts.find((i) => i.table === "phone_calls")).toBeDefined();
  });
});

describe("POST /api/phone/webhook/voice-inbound — unknown number", () => {
  it("hangs up (empty <Response/>) and writes no call row when To matches no org number", async () => {
    const tables = ringAllTables();
    const { client, inserts } = makeServiceClient(tables);
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(voiceForm({ To: "+19998887777" }));
    const xml = await res.text();

    expect(res.status).toBe(200);
    expect(xml).toContain("<Response");
    expect(xml).not.toContain("<Dial");
    expect(xml).not.toContain("<Record");
    expect(inserts.find((i) => i.table === "phone_calls")).toBeUndefined();
  });
});
