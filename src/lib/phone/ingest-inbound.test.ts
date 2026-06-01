// PRD #304 — Nookleus Phone. Slice 15 (#368) — ingestInbound helper.
//
// `ingestInbound` is the conversation/message persistence the inbound SMS
// webhook used to perform inline. It's been extracted so both the real
// inbound webhook AND the dev-mode `simulate-inbound` route call exactly
// the same helper — the demo path cannot drift from real inbound behavior.
//
// Responsibilities (order matters):
//   1. STOP-keyword opt-out upsert BEFORE message persist (defense in
//      depth — the gate cannot be bypassed by a half-failed insert).
//   2. Upsert the Conversation by (phone_number_id, outside_e164).
//   3. Insert the inbound phone_messages row with direction='in' and the
//      smart-attach job_tag (when decision is 'auto').
//   4. Bump unread_count and last_event_at on the conversation.
//   5. HELP auto-reply (when classified as help AND the outbound feature
//      flag is on) — dispatched via `sendSms`, logged as a phone_messages
//      'out' row.
//
// These tests use the same lightweight Supabase-builder fake as the
// inbound-webhook tests so we're verifying observable database effects,
// not implementation wiring.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendSmsMock = vi.fn();
const createTwilioClientMock = vi.fn();
vi.mock("./twilio-client", () => ({
  sendSms: (...args: unknown[]) => sendSmsMock(...args),
  createTwilioClient: () => createTwilioClientMock(),
}));

import { ingestInbound } from "./ingest-inbound";
import type { RouteInboundDecision } from "./route-inbound";

type Row = Record<string, unknown>;

interface BuilderTables {
  phone_conversations: Row[];
  phone_messages: Row[];
  phone_opt_outs: Row[];
  organizations: Row[];
}

function makeServiceClient(tables: BuilderTables) {
  const inserts: { table: string; row: Row }[] = [];
  const upserts: { table: string; row: Row; onConflict: string | undefined }[] = [];
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
        const row = { id: `new-${inserts.length + upserts.length}`, ...pendingInsert };
        (tables as unknown as Record<string, Row[]>)[table].push(row);
        return { data: row, error: null };
      }
      return { data: rows[0] ?? null, error: rows[0] ? null : { message: "no rows" } };
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

  return {
    client: { from: builder } as unknown as Parameters<typeof ingestInbound>[0]["supabase"],
    inserts,
    upserts,
    updates,
  };
}

const BASE_DECISION: RouteInboundDecision = {
  organizationId: "org-1",
  phoneNumberId: "pn-1",
  phoneNumberKind: "shared",
  phoneNumberOwnerId: null,
  outsideE164: "+15551234567",
  conversationKey: { phoneNumberId: "pn-1", outsideE164: "+15551234567" },
  contactId: null,
  smartAttach: { kind: "untagged" },
};

beforeEach(() => {
  vi.clearAllMocks();
  sendSmsMock.mockResolvedValue({ sid: "SM-auto", status: "queued" });
  createTwilioClientMock.mockReturnValue({});
  vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ingestInbound — conversation upsert + message insert", () => {
  it("upserts the conversation by (phone_number_id, outside_e164) and inserts the inbound message", async () => {
    const { client, upserts, inserts } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });

    await ingestInbound({
      supabase: client,
      decision: BASE_DECISION,
      toE164: "+15125550000",
      rawBody: "Hello!",
      mediaUrls: [],
      twilioSid: "SMabc",
      smsStatus: "received",
    });

    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      table: "phone_conversations",
      onConflict: "phone_number_id,outside_e164",
      row: {
        organization_id: "org-1",
        phone_number_id: "pn-1",
        outside_e164: "+15551234567",
      },
    });
    const msgInsert = inserts.find((i) => i.table === "phone_messages");
    expect(msgInsert?.row).toMatchObject({
      organization_id: "org-1",
      direction: "in",
      from_e164: "+15551234567",
      to_e164: "+15125550000",
      body: "Hello!",
      twilio_sid: "SMabc",
      status: "received",
      job_tag: null,
    });
  });

  it("auto-attaches the message to the Job when smartAttach.kind is 'auto'", async () => {
    const { client, inserts } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });

    await ingestInbound({
      supabase: client,
      decision: {
        ...BASE_DECISION,
        contactId: "c-1",
        smartAttach: { kind: "auto", jobId: "job-7" },
      },
      toE164: "+15125550000",
      rawBody: "on my way",
      mediaUrls: [],
      twilioSid: null,
      smsStatus: null,
    });

    const msg = inserts.find((i) => i.table === "phone_messages");
    expect(msg?.row).toMatchObject({ job_tag: "job-7" });
  });

  it("bumps unread_count and last_event_at after persisting the message", async () => {
    const { client, updates } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });

    await ingestInbound({
      supabase: client,
      decision: BASE_DECISION,
      toE164: "+15125550000",
      rawBody: "hi",
      mediaUrls: [],
      twilioSid: null,
      smsStatus: null,
    });

    const bump = updates.find((u) => u.table === "phone_conversations");
    expect(bump).toBeDefined();
    expect(bump?.patch).toHaveProperty("unread_count");
    expect(bump?.patch).toHaveProperty("last_event_at");
  });
});

describe("ingestInbound — STOP opt-out", () => {
  it("upserts a phone_opt_outs row before persisting the message", async () => {
    const { client, upserts, inserts } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });

    await ingestInbound({
      supabase: client,
      decision: BASE_DECISION,
      toE164: "+15125550000",
      rawBody: "STOP",
      mediaUrls: [],
      twilioSid: null,
      smsStatus: null,
    });

    const oo = upserts.find((u) => u.table === "phone_opt_outs");
    expect(oo).toBeDefined();
    expect(oo?.row).toMatchObject({
      organization_id: "org-1",
      outside_e164: "+15551234567",
    });
    expect(oo?.onConflict).toContain("organization_id");
    expect(oo?.onConflict).toContain("outside_e164");
    // The message itself is still recorded — the customer's STOP is the
    // audit trail.
    const msg = inserts.find((i) => i.table === "phone_messages");
    expect(msg?.row).toMatchObject({ direction: "in", body: "STOP" });
    // STOP does not trigger an auto-reply (Twilio's A2P 10DLC rules
    // handle the STOP confirmation at the carrier level).
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});

describe("ingestInbound — HELP auto-reply", () => {
  it("dispatches an org-named auto-reply via sendSms when classified as HELP", async () => {
    const { client, inserts } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });

    await ingestInbound({
      supabase: client,
      decision: BASE_DECISION,
      toE164: "+15125550000",
      rawBody: "HELP",
      mediaUrls: [],
      twilioSid: null,
      smsStatus: null,
    });

    expect(sendSmsMock).toHaveBeenCalledOnce();
    const sendArgs = sendSmsMock.mock.calls[0][1] as { from: string; to: string; body: string };
    expect(sendArgs.from).toBe("+15125550000");
    expect(sendArgs.to).toBe("+15551234567");
    expect(sendArgs.body).toMatch(/AAA Contracting/i);
    expect(sendArgs.body).toMatch(/STOP/i);
    // The outbound auto-reply is logged as its own phone_messages row.
    const out = inserts.find(
      (i) => i.table === "phone_messages" && i.row.direction === "out",
    );
    expect(out?.row).toMatchObject({
      direction: "out",
      to_e164: "+15551234567",
      twilio_sid: "SM-auto",
    });
  });

  it("does NOT dispatch HELP auto-reply when NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    const { client } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });

    await ingestInbound({
      supabase: client,
      decision: BASE_DECISION,
      toE164: "+15125550000",
      rawBody: "HELP",
      mediaUrls: [],
      twilioSid: null,
      smsStatus: null,
    });

    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});
