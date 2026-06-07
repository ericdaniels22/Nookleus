// PRD #304 — Nookleus Phone. Slice 8 (#312) — ingestInboundCall helper.
//
// The conversation-threading + call-row persistence the inbound VOICE
// webhook performs. It mirrors `ingestInbound` (the SMS helper): a voice
// call threads on the SAME phone_conversations row as the slice-4 messages
// (natural key: phone_number_id + outside_e164), so a call and a text to
// the same outside number interleave in one Phone-tab thread.
//
// Responsibilities:
//   1. Upsert the Conversation by (phone_number_id, outside_e164) — sets
//      last_event_at so the thread sorts to the top.
//   2. Insert a phone_calls row (direction='in', status='ringing' at
//      dial-start) carrying the smart-attach job_tag when the decision is
//      'auto'. The status-callback webhook later advances status +
//      duration_seconds + ended_at.
//
// Unlike ingestInbound, a call does NOT bump unread_count: a 'ringing'
// insert happens before we know whether the call was answered, so counting
// every inbound call as unread would inflate the badge for answered calls.
// The missed-call surfacing is a thread-render concern, not a counter.
//
// These tests use the same lightweight Supabase-builder fake as the
// inbound-webhook + ingestInbound tests — verifying observable database
// effects, not wiring.

import { describe, it, expect } from "vitest";
import { ingestInboundCall } from "./ingest-inbound-call";
import type { RouteInboundDecision } from "./route-inbound";

type Row = Record<string, unknown>;

interface BuilderTables {
  phone_conversations: Row[];
  phone_calls: Row[];
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
    client: { from: builder } as unknown as Parameters<typeof ingestInboundCall>[0]["supabase"],
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

describe("ingestInboundCall — call-row persistence", () => {
  it("upserts the conversation then inserts a ringing inbound phone_calls row", async () => {
    const { client, upserts, inserts } = makeServiceClient({
      phone_conversations: [],
      phone_calls: [],
    });

    await ingestInboundCall({
      supabase: client,
      decision: BASE_DECISION,
      toE164: "+15125550000",
      twilioCallSid: "CA-abc",
      status: "ringing",
    });

    // Threaded on the same natural key as the SMS path.
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      table: "phone_conversations",
      onConflict: "phone_number_id,outside_e164",
      row: {
        organization_id: "org-1",
        phone_number_id: "pn-1",
        outside_e164: "+15551234567",
        contact_id: null,
      },
    });
    // The call row.
    const callInsert = inserts.find((i) => i.table === "phone_calls");
    expect(callInsert).toBeDefined();
    expect(callInsert!.row).toMatchObject({
      organization_id: "org-1",
      direction: "in",
      from_e164: "+15551234567",
      to_e164: "+15125550000",
      twilio_call_sid: "CA-abc",
      status: "ringing",
      initiated_by_user_id: null,
    });
  });

  it("carries the smart-attach job_tag when the decision is 'auto'", async () => {
    const { client, inserts } = makeServiceClient({
      phone_conversations: [],
      phone_calls: [],
    });

    await ingestInboundCall({
      supabase: client,
      decision: {
        ...BASE_DECISION,
        contactId: "c-1",
        smartAttach: { kind: "auto", jobId: "job-1" },
      },
      toE164: "+15125550000",
      twilioCallSid: "CA-auto",
      status: "ringing",
    });

    const callInsert = inserts.find((i) => i.table === "phone_calls");
    expect(callInsert!.row).toMatchObject({
      job_tag: "job-1",
      tagged_by_user_id: null, // auto-tagged, not a human action
    });
  });

  it("leaves job_tag null when the decision is untagged", async () => {
    const { client, inserts } = makeServiceClient({
      phone_conversations: [],
      phone_calls: [],
    });

    await ingestInboundCall({
      supabase: client,
      decision: BASE_DECISION, // smartAttach: { kind: "untagged" }
      toE164: "+15125550000",
      twilioCallSid: "CA-untagged",
      status: "ringing",
    });

    const callInsert = inserts.find((i) => i.table === "phone_calls");
    expect(callInsert!.row.job_tag).toBeNull();
  });
});
