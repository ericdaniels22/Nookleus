// PRD #368 — Phone demo/dev mode. Slice 15b (#371).
//
// `ingestInbound` is the persistence half of the inbound-SMS pipeline.
// The webhook route owns I/O at the edge (signature, form parsing,
// org/number resolution, contacts + active-jobs loads, MMS copy);
// `ingestInbound` owns the writes:
//
//   - STOP keyword → phone_opt_outs upsert BEFORE message insert.
//   - Conversation upsert by (phone_number_id, outside_e164).
//   - Inbound phone_messages insert (direction='in', smart-attach job_tag).
//   - unread_count + last_event_at bump.
//   - HELP keyword → outbound auto-reply via sendSms, logged as a
//     direction='out' phone_messages row (gated by isPhoneOutboundEnabled).
//
// The Supabase service client and the Twilio client are injected so the
// helper is provider-agnostic — the demo simulator (15c) replaces
// `sendSms`'s twilio-client argument with a fake without touching this
// module.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const sendSmsModuleMock = vi.fn();
const createTwilioClientModuleMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  sendSms: (...args: unknown[]) => sendSmsModuleMock(...args),
  createTwilioClient: () => createTwilioClientModuleMock(),
}));

import { ingestInbound } from "./ingest-inbound";
import type { RouteInboundDecision } from "./route-inbound";

interface Row { [key: string]: unknown }

interface BuilderTables {
  phone_conversations: Row[];
  phone_messages: Row[];
  phone_opt_outs?: Row[];
}

function makeServiceClient(tables: BuilderTables) {
  const inserts: { table: string; row: Row }[] = [];
  const upserts: { table: string; row: Row; onConflict: string | undefined }[] =
    [];
  const updates: { table: string; patch: Row; filters: Row }[] = [];
  // Order tracker: every write (insert/upsert) is appended in call order
  // so tests can assert ordering (e.g. STOP opt-out BEFORE message
  // insert).
  const writeOrder: string[] = [];

  function builder(table: string) {
    let rows = (tables as unknown as Record<string, Row[]>)[table] ?? [];
    const ctx: { filters: Row } = { filters: {} };
    let pendingInsert: Row | null = null;
    let pendingUpdate: Row | null = null;

    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      ctx.filters[col] = val;
      rows = rows.filter((r) => r[col] === val);
      return b;
    };
    b.insert = (row: Row) => {
      pendingInsert = row;
      inserts.push({ table, row });
      writeOrder.push(`insert:${table}`);
      return b;
    };
    b.upsert = (row: Row, opts?: { onConflict?: string }) => {
      pendingInsert = row;
      upserts.push({ table, row, onConflict: opts?.onConflict });
      writeOrder.push(`upsert:${table}`);
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
    client: { from: builder } as unknown as SupabaseClient,
    inserts,
    upserts,
    updates,
    writeOrder,
  };
}

function untaggedDecision(): RouteInboundDecision {
  return {
    organizationId: "org-1",
    phoneNumberId: "pn-1",
    phoneNumberKind: "shared",
    phoneNumberOwnerId: null,
    outsideE164: "+15551234567",
    conversationKey: { phoneNumberId: "pn-1", outsideE164: "+15551234567" },
    contactId: null,
    smartAttach: { kind: "untagged" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
  sendSmsModuleMock.mockResolvedValue({ sid: "SM-auto", status: "queued" });
  createTwilioClientModuleMock.mockReturnValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ingestInbound — conversation + message persistence", () => {
  it("upserts the conversation by (phone_number_id, outside_e164) and inserts the inbound message", async () => {
    const { client, upserts, inserts } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
    });

    await ingestInbound(client, {
      decision: untaggedDecision(),
      toE164: "+15125550000",
      body: "Hello!",
      messageSid: "SMabc",
      smsStatus: "received",
      mediaUrls: [],
      orgName: "AAA Contracting",
    });

    const convUpsert = upserts.find((u) => u.table === "phone_conversations");
    expect(convUpsert).toBeDefined();
    expect(convUpsert).toMatchObject({
      onConflict: "phone_number_id,outside_e164",
      row: {
        organization_id: "org-1",
        phone_number_id: "pn-1",
        outside_e164: "+15551234567",
        contact_id: null,
      },
    });

    const msgInsert = inserts.find((i) => i.table === "phone_messages");
    expect(msgInsert).toBeDefined();
    expect(msgInsert!.row).toMatchObject({
      organization_id: "org-1",
      direction: "in",
      from_e164: "+15551234567",
      to_e164: "+15125550000",
      body: "Hello!",
      twilio_sid: "SMabc",
      status: "received",
      job_tag: null,
      media_urls: [],
    });
  });

  it("bumps unread_count and last_event_at on the conversation", async () => {
    const { client, updates } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
    });

    await ingestInbound(client, {
      decision: untaggedDecision(),
      toE164: "+15125550000",
      body: "ping",
      messageSid: "SMping",
      smsStatus: "received",
      mediaUrls: [],
      orgName: "AAA Contracting",
    });

    const bump = updates.find((u) => u.table === "phone_conversations");
    expect(bump).toBeDefined();
    expect(bump!.patch.unread_count).toBe(1);
    expect(typeof bump!.patch.last_event_at).toBe("string");
  });

  it("passes the smart-attach auto jobId into job_tag", async () => {
    const { client, inserts } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
    });

    const decision: RouteInboundDecision = {
      ...untaggedDecision(),
      contactId: "c-1",
      smartAttach: { kind: "auto", jobId: "job-1" },
    };

    await ingestInbound(client, {
      decision,
      toE164: "+15125550000",
      body: "on my way",
      messageSid: "SM-auto",
      smsStatus: "received",
      mediaUrls: [],
      orgName: "AAA Contracting",
    });

    const msg = inserts.find((i) => i.table === "phone_messages");
    expect(msg!.row).toMatchObject({ job_tag: "job-1", tagged_by_user_id: null });
  });

  it("passes through persisted media_urls onto the inbound row", async () => {
    const { client, inserts } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
    });

    await ingestInbound(client, {
      decision: untaggedDecision(),
      toE164: "+15125550000",
      body: "look",
      messageSid: "SMmms",
      smsStatus: "received",
      mediaUrls: [
        { storage_path: "org-1/a.jpeg", media_type: "image/jpeg" },
        { storage_path: "org-1/b.png", media_type: "image/png" },
      ],
      orgName: "AAA Contracting",
    });

    const msg = inserts.find((i) => i.table === "phone_messages");
    expect(msg!.row.media_urls).toEqual([
      { storage_path: "org-1/a.jpeg", media_type: "image/jpeg" },
      { storage_path: "org-1/b.png", media_type: "image/png" },
    ]);
  });
});

describe("ingestInbound — STOP opt-out registry", () => {
  it("upserts phone_opt_outs BEFORE the inbound message lands", async () => {
    // Defense-in-depth: the opt-out must be recorded even if a later
    // write fails. Asserting via the recorded write-order rather than
    // mock-call order keeps this resilient to internal refactors.
    const { client, upserts, writeOrder } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
    });

    await ingestInbound(client, {
      decision: untaggedDecision(),
      toE164: "+15125550000",
      body: "STOP",
      messageSid: "SMstop",
      smsStatus: "received",
      mediaUrls: [],
      orgName: "AAA Contracting",
    });

    const optOutUpsert = upserts.find((u) => u.table === "phone_opt_outs");
    expect(optOutUpsert).toBeDefined();
    expect(optOutUpsert!.onConflict).toBe("organization_id,outside_e164");
    expect(optOutUpsert!.row).toMatchObject({
      organization_id: "org-1",
      outside_e164: "+15551234567",
    });

    const optOutIdx = writeOrder.indexOf("upsert:phone_opt_outs");
    const msgIdx = writeOrder.indexOf("insert:phone_messages");
    expect(optOutIdx).toBeGreaterThanOrEqual(0);
    expect(msgIdx).toBeGreaterThan(optOutIdx);
  });

  it("STILL writes the opt-out row when the outbound flag is off", async () => {
    // The STOP path is inbound-only — no outbound SMS — so it must keep
    // working when the outbound feature flag is off.
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    const { client, upserts } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
    });

    await ingestInbound(client, {
      decision: untaggedDecision(),
      toE164: "+15125550000",
      body: "unsubscribe",
      messageSid: "SMstop2",
      smsStatus: "received",
      mediaUrls: [],
      orgName: "AAA Contracting",
    });

    expect(upserts.find((u) => u.table === "phone_opt_outs")).toBeDefined();
    expect(sendSmsModuleMock).not.toHaveBeenCalled();
  });
});

describe("ingestInbound — HELP auto-reply", () => {
  it("dispatches sendSms with the org name and logs the outbound row", async () => {
    const { client, inserts } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
    });

    await ingestInbound(client, {
      decision: untaggedDecision(),
      toE164: "+15125550000",
      body: "HELP",
      messageSid: "SMhelp",
      smsStatus: "received",
      mediaUrls: [],
      orgName: "AAA Contracting",
    });

    expect(sendSmsModuleMock).toHaveBeenCalledOnce();
    const sendArgs = sendSmsModuleMock.mock.calls[0][1] as {
      from: string;
      to: string;
      body: string;
    };
    expect(sendArgs.from).toBe("+15125550000");
    expect(sendArgs.to).toBe("+15551234567");
    expect(sendArgs.body).toMatch(/AAA Contracting/);
    expect(sendArgs.body).toMatch(/STOP/);

    const outRow = inserts.find(
      (i) => i.table === "phone_messages" && i.row.direction === "out",
    );
    expect(outRow!.row).toMatchObject({
      direction: "out",
      from_e164: "+15125550000",
      to_e164: "+15551234567",
      twilio_sid: "SM-auto",
      job_tag: null,
    });
  });

  it("does NOT dispatch when the outbound flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    const { client, inserts } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
    });

    await ingestInbound(client, {
      decision: untaggedDecision(),
      toE164: "+15125550000",
      body: "HELP",
      messageSid: "SMhelp",
      smsStatus: "received",
      mediaUrls: [],
      orgName: "AAA Contracting",
    });

    expect(sendSmsModuleMock).not.toHaveBeenCalled();
    expect(
      inserts.find((i) => i.table === "phone_messages" && i.row.direction === "out"),
    ).toBeUndefined();
  });

  it("does NOT dispatch for ordinary inbound messages", async () => {
    const { client } = makeServiceClient({
      phone_conversations: [],
      phone_messages: [],
    });

    await ingestInbound(client, {
      decision: untaggedDecision(),
      toE164: "+15125550000",
      body: "hello, can you come tuesday",
      messageSid: "SMplain",
      smsStatus: "received",
      mediaUrls: [],
      orgName: "AAA Contracting",
    });

    expect(sendSmsModuleMock).not.toHaveBeenCalled();
  });
});
