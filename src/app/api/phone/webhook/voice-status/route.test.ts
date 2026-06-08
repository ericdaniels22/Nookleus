// PRD #304 — Nookleus Phone. Slice 8 (#312) — inbound VOICE status callback.
//
// Twilio POSTs here for every voice call we route, on each CallStatus
// transition. The callback carries:
//   CallSid      — matches the `twilio_call_sid` we stored on phone_calls
//   CallStatus   — 'queued' | 'ringing' | 'in-progress' | 'completed' |
//                  'busy' | 'no-answer' | 'failed' | 'canceled'
//   CallDuration — seconds (present once the call has ended)
//
// The route looks the row up by CallSid and advances `status` (mapping
// Twilio's hyphenated vocabulary — 'in-progress', 'no-answer' — to our
// underscore CHECK vocabulary). On a terminal status it also writes
// `duration_seconds` (from CallDuration) and `ended_at`.
//
// Unauthenticated; gated solely by X-Twilio-Signature. Service-client
// UPDATE — no auth user, so RLS would otherwise refuse.

import { describe, it, expect, vi, beforeEach } from "vitest";

const validateSignatureMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  validateTwilioSignature: (...args: unknown[]) => validateSignatureMock(...args),
}));

const createServiceClientMock = vi.fn();
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: () => createServiceClientMock(),
}));

import { POST } from "./route";

type Row = Record<string, unknown>;

function makeServiceClient(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { phone_calls: [], ...seed };
  const updates: { table: string; patch: Row; filters: Row }[] = [];

  function builder(table: string) {
    let rows = tables[table] ?? [];
    const ctx: { filters: Row } = { filters: {} };
    let pendingUpdate: Row | null = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      ctx.filters[col] = val;
      rows = rows.filter((r) => r[col] === val);
      return b;
    };
    b.update = (patch: Row) => {
      pendingUpdate = patch;
      return b;
    };
    b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    b.then = (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      if (pendingUpdate) {
        updates.push({ table, patch: pendingUpdate, filters: { ...ctx.filters } });
        return resolve({ data: [], error: null });
      }
      return resolve({ data: rows, error: null });
    };
    return b;
  }

  return { client: { from: builder }, tables, updates };
}

function callbackForm(opts: {
  CallSid?: string;
  CallStatus?: string;
  CallDuration?: string;
}): Request {
  const params = new URLSearchParams();
  params.set("CallSid", opts.CallSid ?? "CA-1");
  if (opts.CallStatus !== undefined) params.set("CallStatus", opts.CallStatus);
  if (opts.CallDuration !== undefined)
    params.set("CallDuration", opts.CallDuration);
  return new Request("http://test/api/phone/webhook/voice-status", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "valid",
    },
    body: params.toString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  validateSignatureMock.mockReturnValue(true);
});

describe("POST /api/phone/webhook/voice-status — terminal completed (tracer)", () => {
  it("updates status, duration_seconds, and ended_at by twilio_call_sid", async () => {
    const { client, updates } = makeServiceClient({
      phone_calls: [{ id: "call-1", twilio_call_sid: "CA-1", status: "ringing" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      callbackForm({ CallSid: "CA-1", CallStatus: "completed", CallDuration: "42" }),
    );

    expect(res.status).toBe(200);
    const upd = updates.find((u) => u.table === "phone_calls");
    expect(upd).toBeDefined();
    expect(upd!.filters).toMatchObject({ twilio_call_sid: "CA-1" });
    expect(upd!.patch).toMatchObject({ status: "completed", duration_seconds: 42 });
    expect(upd!.patch.ended_at).toBeTruthy();
  });
});

describe("POST /api/phone/webhook/voice-status — signature + guards", () => {
  it("returns 403 when the Twilio signature is invalid", async () => {
    validateSignatureMock.mockReturnValue(false);
    const { client } = makeServiceClient({});
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(callbackForm({ CallStatus: "completed" }));

    expect(res.status).toBe(403);
  });

  it("returns 400 when CallSid is missing", async () => {
    const { client } = makeServiceClient({});
    createServiceClientMock.mockReturnValue(client);
    const req = new Request("http://test/api/phone/webhook/voice-status", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "valid",
      },
      body: "CallStatus=completed",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 200 (silent drop) when CallSid matches no row", async () => {
    const { client, updates } = makeServiceClient({ phone_calls: [] });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(callbackForm({ CallSid: "CA-unknown", CallStatus: "completed" }));

    // The UPDATE still runs (matching zero rows); 200 so Twilio stops retrying.
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
  });
});

// Slice 10 (#314) — the OUTBOUND bridge call reuses this webhook unchanged.
// The route keys updates on `twilio_call_sid` and never inspects direction,
// so an outbound (direction:'out') row is advanced through the same state
// machine. These tests document that reuse — no new webhook ships for #314.
describe("POST /api/phone/webhook/voice-status — outbound bridge call (#314)", () => {
  it("advances a direction:'out' row from ringing to in_progress to completed by CallSid", async () => {
    // ringing → in_progress (non-terminal)
    {
      const { client, updates } = makeServiceClient({
        phone_calls: [
          {
            id: "call-out",
            twilio_call_sid: "CA-out",
            direction: "out",
            status: "ringing",
          },
        ],
      });
      createServiceClientMock.mockReturnValue(client);

      const res = await POST(
        callbackForm({ CallSid: "CA-out", CallStatus: "in-progress" }),
      );

      expect(res.status).toBe(200);
      const upd = updates.find((u) => u.table === "phone_calls");
      expect(upd!.filters).toMatchObject({ twilio_call_sid: "CA-out" });
      expect(upd!.patch).toMatchObject({ status: "in_progress" });
      expect(upd!.patch.ended_at).toBeUndefined();
    }

    // in_progress → completed (terminal — duration + ended_at)
    {
      const { client, updates } = makeServiceClient({
        phone_calls: [
          {
            id: "call-out",
            twilio_call_sid: "CA-out",
            direction: "out",
            status: "in_progress",
          },
        ],
      });
      createServiceClientMock.mockReturnValue(client);

      const res = await POST(
        callbackForm({
          CallSid: "CA-out",
          CallStatus: "completed",
          CallDuration: "73",
        }),
      );

      expect(res.status).toBe(200);
      const upd = updates.find((u) => u.table === "phone_calls");
      expect(upd!.patch).toMatchObject({
        status: "completed",
        duration_seconds: 73,
      });
      expect(upd!.patch.ended_at).toBeTruthy();
    }
  });
});

describe("POST /api/phone/webhook/voice-status — Twilio status vocabulary mapping", () => {
  it("maps hyphenated 'in-progress' to 'in_progress' without stamping ended_at (non-terminal)", async () => {
    const { client, updates } = makeServiceClient({
      phone_calls: [{ id: "call-1", twilio_call_sid: "CA-1", status: "ringing" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(callbackForm({ CallSid: "CA-1", CallStatus: "in-progress" }));

    expect(res.status).toBe(200);
    const upd = updates.find((u) => u.table === "phone_calls");
    expect(upd!.patch).toMatchObject({ status: "in_progress" });
    // Mid-call: no duration, no ended_at yet.
    expect(upd!.patch.ended_at).toBeUndefined();
    expect(upd!.patch.duration_seconds).toBeUndefined();
  });

  it("maps 'no-answer' to 'no_answer' and stamps ended_at (terminal)", async () => {
    const { client, updates } = makeServiceClient({
      phone_calls: [{ id: "call-1", twilio_call_sid: "CA-1", status: "ringing" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(callbackForm({ CallSid: "CA-1", CallStatus: "no-answer" }));

    expect(res.status).toBe(200);
    const upd = updates.find((u) => u.table === "phone_calls");
    expect(upd!.patch).toMatchObject({ status: "no_answer" });
    expect(upd!.patch.ended_at).toBeTruthy();
  });

  it("accepts every Twilio voice CallStatus without throwing", async () => {
    const statuses = [
      "queued",
      "ringing",
      "in-progress",
      "completed",
      "busy",
      "no-answer",
      "failed",
      "canceled",
    ];
    for (const status of statuses) {
      const { client, updates } = makeServiceClient({
        phone_calls: [{ id: "call", twilio_call_sid: "CA-1", status: "ringing" }],
      });
      createServiceClientMock.mockReturnValue(client);

      const res = await POST(callbackForm({ CallSid: "CA-1", CallStatus: status }));

      expect(res.status).toBe(200);
      // The persisted status never contains a hyphen (our CHECK vocabulary).
      expect(String(updates[0]?.patch.status)).not.toContain("-");
    }
  });
});
