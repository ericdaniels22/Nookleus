// PRD #304 — Nookleus Phone. Slice 5 (#309) — outbound status callback.
//
// Twilio POSTs delivery transitions to this URL for every outbound SMS
// that was dispatched with a `statusCallback` URL (see
// src/app/api/phone/messages/route.ts). The callback carries:
//   MessageSid    — matches the `twilio_sid` we stored on phone_messages
//   MessageStatus — 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed'
//
// AC: "Status callback webhook updates phone_messages.status (sent →
//      delivered, or failed) and the thread UI reflects the status"
//
// The route is unauthenticated (Twilio is not a user); X-Twilio-Signature
// is the gate. Service-client UPDATE under-the-hood — no auth user is
// present.

import { describe, it, expect, vi, beforeEach } from "vitest";

const validateSignatureMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  validateTwilioSignature: (...args: unknown[]) =>
    validateSignatureMock(...args),
}));

const createServiceClientMock = vi.fn();
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: () => createServiceClientMock(),
}));

import { POST } from "./route";

type Row = Record<string, unknown>;

function makeServiceClient(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { phone_messages: [], ...seed };
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
    b.single = async () => ({
      data: rows[0] ?? null,
      error: rows[0] ? null : { message: "no rows" },
    });
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

  return { client: { from: builder }, tables, updates };
}

function callbackForm(opts: {
  MessageSid?: string;
  MessageStatus?: string;
}): Request {
  const params = new URLSearchParams();
  params.set("MessageSid", opts.MessageSid ?? "SM-out");
  params.set("MessageStatus", opts.MessageStatus ?? "delivered");
  return new Request("http://test/api/phone/webhook/status-callback", {
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

describe("POST /api/phone/webhook/status-callback", () => {
  it("returns 403 when the Twilio signature is invalid", async () => {
    validateSignatureMock.mockReturnValue(false);
    const { client } = makeServiceClient({});
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(callbackForm({}));

    expect(res.status).toBe(403);
  });

  it("updates the matching phone_messages row's status by twilio_sid", async () => {
    const { client, updates } = makeServiceClient({
      phone_messages: [
        {
          id: "msg-1",
          organization_id: "org-1",
          twilio_sid: "SM-out",
          status: "queued",
        },
      ],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      callbackForm({ MessageSid: "SM-out", MessageStatus: "delivered" }),
    );

    expect(res.status).toBe(200);
    const upd = updates.find((u) => u.table === "phone_messages");
    expect(upd?.patch).toMatchObject({ status: "delivered" });
    expect(upd?.filters).toMatchObject({ twilio_sid: "SM-out" });
  });

  it("returns 200 (silent drop) when MessageSid does not match any row", async () => {
    // A wrong-org webhook URL or a stale SID is harmless; Twilio retries
    // on non-2xx, which is the worst-case outcome.
    const { client, updates } = makeServiceClient({
      phone_messages: [],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      callbackForm({ MessageSid: "SM-unknown", MessageStatus: "delivered" }),
    );

    // The route still runs an UPDATE WHERE twilio_sid = ... — matching
    // zero rows is fine; the response is 200 so Twilio stops retrying.
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
  });

  it("accepts every Twilio terminal status without throwing", async () => {
    const statuses = [
      "accepted",
      "queued",
      "sending",
      "sent",
      "delivered",
      "undelivered",
      "failed",
    ];
    for (const status of statuses) {
      const { client, updates } = makeServiceClient({
        phone_messages: [
          { id: "msg", twilio_sid: "SM-out", status: "queued" },
        ],
      });
      createServiceClientMock.mockReturnValue(client);

      const res = await POST(callbackForm({ MessageStatus: status }));

      expect(res.status).toBe(200);
      expect(updates[0]?.patch).toMatchObject({ status });
    }
  });

  it("returns 400 when MessageSid is missing", async () => {
    const { client } = makeServiceClient({});
    createServiceClientMock.mockReturnValue(client);
    const req = new Request("http://test/api/phone/webhook/status-callback", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "valid",
      },
      body: "MessageStatus=delivered",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});
