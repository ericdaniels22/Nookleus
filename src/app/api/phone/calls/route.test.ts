// PRD #304 — Nookleus Phone. Slice 10 (#314) — outbound bridge call.
//
// Tests for the outbound bridge-call route. AC bullets covered:
//   - "A Crew Lead clicks Call; Twilio rings THEIR OWN cell (from
//      user_profiles.phone); on answer, bridges them to the customer with
//      callerId = a Nookleus-owned number (never the crew lead's real cell)."
//   - "phone_calls row with direction='out', initiated_by_user_id set, status
//      tracking the Twilio state machine."
//   - "Opt-out refused before any Twilio call."
//   - "Refuse if the caller's profile has no cell."
//   - "Refuse any `from` that is not an active Nookleus-owned org number."
//   - "Job-page call auto-tags to that Job; Phone-tab / Contact-card calls
//      untagged."
//   - "Vitest route test: signature(view_phone gate), opt-out gate,
//      profile-cell gate, owned-number gate, Twilio dispatch (mocked)."
//
// Route shape:
//   POST /api/phone/calls
//   body: {
//     conversationId?: string,         // existing thread
//     outsideE164?: string,            // first contact in a new thread
//     sourceContext?: 'phone-tab' | 'contact' | 'contact-card'
//                     | { kind: 'job', jobId }
//   }
//
// view_phone gate; Twilio is mocked at the module boundary. The pure modules
// (select-outbound-number, smart-attach) run for real. Unlike the SMS route
// there is NO A2P feature-flag gate — voice has no 10DLC dependency, so the
// route is live wherever view_phone is granted.

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

const placeBridgeCallMock = vi.fn();
const buildBridgeTwimlMock = vi.fn();
const createTwilioClientMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  placeBridgeCall: (...args: unknown[]) => placeBridgeCallMock(...args),
  buildBridgeTwiml: (...args: unknown[]) => buildBridgeTwimlMock(...args),
  createTwilioClient: () => createTwilioClientMock(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

type Row = Record<string, unknown>;

// A small Supabase service-client fake that records every insert / upsert /
// update so tests can assert on them. Mirrors the fake in the SMS-send route
// test; only the surface the route touches is implemented.
function makeServiceClient(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {
    phone_numbers: [],
    phone_opt_outs: [],
    phone_conversations: [],
    phone_calls: [],
    user_profiles: [],
    jobs: [],
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
        const row: Row = {
          id: `new-${inserts.length + upserts.length}`,
          ...pendingInsert,
        };
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
        updates.push({
          table,
          patch: pendingUpdate,
          filters: { ...ctx.filters },
        });
        return resolve({ data: [], error: null });
      }
      return resolve({ data: rows, error: null });
    };
    return b;
  }

  return { client: { from: builder }, tables, inserts, upserts, updates };
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
  return new Request("http://test/api/phone/calls", {
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
const CREW_PROFILE = { id: "user-1", phone: "+15129990000" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue(ORG);
  createTwilioClientMock.mockReturnValue({});
  buildBridgeTwimlMock.mockReturnValue("<BRIDGE_TWIML>");
  placeBridgeCallMock.mockResolvedValue({ sid: "CA-out", status: "queued" });
  vi.stubEnv(
    "PHONE_VOICE_STATUS_CALLBACK_URL",
    "https://example.com/api/phone/webhook/voice-status",
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// 1. Tracer — the headline AC: ring the crew lead's cell, bridge to the
//    customer with the Nookleus number, write the phone_calls row.
// ---------------------------------------------------------------------------

describe("POST /api/phone/calls — bridge dispatch", () => {
  it("rings the crew lead's own cell FROM the Nookleus number, bridges to the customer, and writes a direction:'out' phone_calls row", async () => {
    authed("user-1", "crew_lead");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [CREW_PROFILE],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(201);

    // The bridge TwiML presents the Nookleus number to the customer — never
    // the crew lead's real cell. This is the caller-ID-spoofing safety.
    expect(buildBridgeTwimlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerE164: "+15551234567",
        callerId: "+15125550000",
      }),
    );

    // Twilio rings the crew lead's OWN cell, from the Nookleus number,
    // executing the inline bridge twiml on answer.
    expect(placeBridgeCallMock).toHaveBeenCalledTimes(1);
    expect(placeBridgeCallMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        from: "+15125550000",
        to: "+15129990000",
        twiml: "<BRIDGE_TWIML>",
        statusCallback: "https://example.com/api/phone/webhook/voice-status",
      }),
    );

    // The phone_calls row records the LOGICAL call (Nookleus → customer); the
    // crew lead's cell is a bridge detail and never appears on the row.
    const callInsert = inserts.find((i) => i.table === "phone_calls");
    expect(callInsert?.row).toMatchObject({
      organization_id: ORG,
      direction: "out",
      from_e164: "+15125550000",
      to_e164: "+15551234567",
      twilio_call_sid: "CA-out",
      status: "queued",
      initiated_by_user_id: "user-1",
    });

    // The 201 echoes the SID + status so the client can render the in-flight row.
    const body = await res.json();
    expect(body).toMatchObject({
      twilio_call_sid: "CA-out",
      status: "queued",
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Opt-out gate — refused BEFORE any Twilio call (TCPA).
// ---------------------------------------------------------------------------

describe("POST /api/phone/calls — opt-out gate", () => {
  it("refuses with 403 and never calls Twilio when the customer has opted out", async () => {
    authed("user-1", "crew_lead");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [CREW_PROFILE],
      phone_opt_outs: [
        {
          id: "opt-1",
          organization_id: ORG,
          outside_e164: "+15551234567",
          re_opted_in_at: null,
        },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(403);
    expect(placeBridgeCallMock).not.toHaveBeenCalled();
    expect(inserts.find((i) => i.table === "phone_calls")).toBeUndefined();
  });

  it("places the call when an earlier opt-out has been re-opted-in (re_opted_in_at set)", async () => {
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [CREW_PROFILE],
      phone_opt_outs: [
        {
          id: "opt-1",
          organization_id: ORG,
          outside_e164: "+15551234567",
          re_opted_in_at: "2026-02-01T00:00:00Z",
        },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(201);
    expect(placeBridgeCallMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Profile-cell gate — refuse if the caller has no cell to ring.
// ---------------------------------------------------------------------------

describe("POST /api/phone/calls — profile-cell gate", () => {
  it("refuses with 422 and never calls Twilio when the caller's profile phone is null", async () => {
    authed("user-1", "crew_lead");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [{ id: "user-1", phone: null }],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(422);
    expect(placeBridgeCallMock).not.toHaveBeenCalled();
    expect(inserts.find((i) => i.table === "phone_calls")).toBeUndefined();
  });

  it("refuses with 422 when the caller has no user_profiles row at all", async () => {
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(422);
    expect(placeBridgeCallMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Owned-number gate — refuse any `from` that is not an active org number.
//    The pure rule can only return a number the org owns; with none, 422.
// ---------------------------------------------------------------------------

describe("POST /api/phone/calls — owned-number gate", () => {
  it("refuses with 422 and never calls Twilio when the org owns no active number", async () => {
    authed("user-1", "crew_lead");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [],
      user_profiles: [CREW_PROFILE],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(422);
    expect(placeBridgeCallMock).not.toHaveBeenCalled();
    expect(inserts.find((i) => i.table === "phone_calls")).toBeUndefined();
  });

  it("ignores a released number from another org and refuses 422 (cross-org / inactive cannot be selected)", async () => {
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({
      phone_numbers: [
        // Released → not selectable.
        { ...SHARED_NUM_ROW, id: "num-released", released_at: "2026-01-02T00:00:00Z" },
        // Other org → not selectable.
        { ...SHARED_NUM_ROW, id: "num-other-org", organization_id: "org-2" },
      ],
      user_profiles: [CREW_PROFILE],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(422);
    expect(placeBridgeCallMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. view_phone gate (the wrapper) — a crew_member without the grant is 403.
// ---------------------------------------------------------------------------

describe("POST /api/phone/calls — view_phone gate", () => {
  it("returns 403 for a member without view_phone and never reaches Twilio", async () => {
    authed("user-2", "crew_member"); // memberTables grants [] for crew_member
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [CREW_PROFILE],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(403);
    expect(placeBridgeCallMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(401);
    expect(placeBridgeCallMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Body validation.
// ---------------------------------------------------------------------------

describe("POST /api/phone/calls — body validation", () => {
  it("returns 400 when neither conversationId nor outsideE164 is given", async () => {
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [CREW_PROFILE],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(sendReq({ sourceContext: "phone-tab" }), noParams);

    expect(res.status).toBe(400);
    expect(placeBridgeCallMock).not.toHaveBeenCalled();
  });

  it("returns 400 when outsideE164 is not a valid phone number", async () => {
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [CREW_PROFILE],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ outsideE164: "not-a-phone", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(400);
    expect(placeBridgeCallMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. conversationId path — call into an existing thread.
// ---------------------------------------------------------------------------

describe("POST /api/phone/calls — existing conversation", () => {
  it("uses the conversation's outside_e164 and writes the row under that conversation", async () => {
    authed("user-1", "crew_lead");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [CREW_PROFILE],
      phone_conversations: [
        {
          id: "conv-1",
          organization_id: ORG,
          phone_number_id: "num-shared",
          outside_e164: "+15557654321",
          contact_id: null,
        },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ conversationId: "conv-1", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(201);
    expect(buildBridgeTwimlMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerE164: "+15557654321" }),
    );
    const callInsert = inserts.find((i) => i.table === "phone_calls");
    expect(callInsert?.row).toMatchObject({
      conversation_id: "conv-1",
      to_e164: "+15557654321",
      direction: "out",
    });
  });

  it("returns 404 for a conversation in another org (cross-org guard)", async () => {
    authed("user-1", "crew_lead");
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [CREW_PROFILE],
      phone_conversations: [
        {
          id: "conv-x",
          organization_id: "org-2",
          phone_number_id: "num-shared",
          outside_e164: "+15557654321",
          contact_id: null,
        },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ conversationId: "conv-x", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(404);
    expect(placeBridgeCallMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. Smart-attach — Job-page Call auto-tags; ambiguous phone-tab stays
//    untagged on the row (the chips are offered via the echoed smartAttach).
// ---------------------------------------------------------------------------

describe("POST /api/phone/calls — smart-attach", () => {
  it("auto-tags a Job-page call to that Job (sourceContext { kind: 'job' })", async () => {
    authed("user-1", "crew_lead");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [CREW_PROFILE],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({
        outsideE164: "+15551234567",
        sourceContext: { kind: "job", jobId: "job-77" },
      }),
      noParams,
    );

    expect(res.status).toBe(201);
    const callInsert = inserts.find((i) => i.table === "phone_calls");
    expect(callInsert?.row).toMatchObject({ job_tag: "job-77" });
    const body = await res.json();
    expect(body.smartAttach).toMatchObject({ kind: "auto", jobId: "job-77" });
  });

  it("leaves a Contact-card call untagged and offers a chip even when the contact has exactly one Active job (#530)", async () => {
    // The locked rule is "Outbound from Phone tab / Contact card → prompt
    // chips." A single Active job must NOT be auto-tagged on an outbound
    // call — the row persists job_tag null and the 201 echoes a prompt with
    // the one candidate so the UI can offer it. Before #530 this auto-tagged.
    authed("user-1", "crew_lead");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [CREW_PROFILE],
      phone_conversations: [
        {
          id: "conv-2",
          organization_id: ORG,
          phone_number_id: "num-shared",
          outside_e164: "+15550001111",
          contact_id: "contact-9",
        },
      ],
      jobs: [
        {
          id: "job-5",
          organization_id: ORG,
          contact_id: "contact-9",
          job_number: "JOB-005",
          status: "in_progress",
        },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ conversationId: "conv-2", sourceContext: "contact-card" }),
      noParams,
    );

    expect(res.status).toBe(201);
    const callInsert = inserts.find((i) => i.table === "phone_calls");
    expect(callInsert?.row).toMatchObject({ job_tag: null });
    const body = await res.json();
    expect(body.smartAttach.kind).toBe("prompt");
    expect(body.smartAttach.candidates).toEqual([
      { jobId: "job-5", label: "JOB-005" },
    ]);
  });

  it("leaves the row untagged and offers chips when the contact has 2+ Active jobs", async () => {
    authed("user-1", "crew_lead");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [CREW_PROFILE],
      phone_conversations: [
        {
          id: "conv-3",
          organization_id: ORG,
          phone_number_id: "num-shared",
          outside_e164: "+15550002222",
          contact_id: "contact-7",
        },
      ],
      jobs: [
        {
          id: "job-a",
          organization_id: ORG,
          contact_id: "contact-7",
          job_number: "JOB-00A",
          status: "in_progress",
        },
        {
          id: "job-b",
          organization_id: ORG,
          contact_id: "contact-7",
          job_number: "JOB-00B",
          status: "new",
        },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await POST(
      sendReq({ conversationId: "conv-3", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(201);
    const callInsert = inserts.find((i) => i.table === "phone_calls");
    expect(callInsert?.row).toMatchObject({ job_tag: null });
    const body = await res.json();
    expect(body.smartAttach.kind).toBe("prompt");
    expect(body.smartAttach.candidates).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 9. Twilio failure — 502, and NO phone_calls row is written (we never claim
//    a dispatch that didn't happen).
// ---------------------------------------------------------------------------

describe("POST /api/phone/calls — Twilio failure", () => {
  it("returns 502 and writes no phone_calls row when placeBridgeCall throws", async () => {
    authed("user-1", "crew_lead");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM_ROW],
      user_profiles: [CREW_PROFILE],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    placeBridgeCallMock.mockRejectedValueOnce(new Error("21215 unreachable"));

    const res = await POST(
      sendReq({ outsideE164: "+15551234567", sourceContext: "phone-tab" }),
      noParams,
    );

    expect(res.status).toBe(502);
    expect(inserts.find((i) => i.table === "phone_calls")).toBeUndefined();
  });
});
