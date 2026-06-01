// PRD #304 — Nookleus Phone. Slice 15d (#373) — TCPA opt-out lifecycle
// route tests for the demo-mode inbound simulator.
//
// 15a (#370) shipped the fake Twilio provider + production fail-safe.
// 15b (#371) extracted `ingestInbound`. 15c (#372) shipped the
// simulate-inbound dev route. This file pins the **lifecycle that ties
// those slices together**: a simulated STOP records an org-scoped
// opt-out, a follow-up outbound send to that number is refused with
// TCPA 403 (and the fake provider is never called), a simulated HELP
// dispatches the auto-reply through the fake provider, and the
// existing admin re-opt-in route clears the gate so a subsequent send
// goes through.
//
// These tests exercise three real route handlers (`simulate-inbound`,
// `messages`, `opt-outs/[id]/re-opt-in`) against a shared in-memory
// service-client fake. Only the carrier hops are faked; opt-out
// enforcement and re-opt-in run for real exactly as in production. The
// `routeInbound` + `ingestInbound` modules run unmocked, as do
// `opt-out-registry` and `feature-flags`.
//
// Per the issue ACs, the four lifecycle properties pinned here are:
//   - STOP-records-opt-out — proved in route.test.ts ("…BEFORE the
//     message is persisted"); the present file picks up the lifecycle
//     from there.
//   - opt-out-blocks-send — the row written by the simulated STOP gates
//     a subsequent /api/phone/messages send with 403 and zero provider
//     calls.
//   - HELP-auto-reply-via-fake — the simulated HELP dispatches an
//     outbound auto-reply through the demo-mode fake provider (SM-
//     prefixed SID, no carrier touched), the body contains the org's
//     name + opt-out instructions, and the row is direction='out' with
//     job_tag null; HELP records no opt-out and is gated by the same
//     `isPhoneOutboundEnabled()` check as the webhook.
//   - re-opt-in-then-send-succeeds — after the admin re-opt-in route
//     clears the gate, the next /api/phone/messages send goes through.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Twilio is mocked at the module boundary. The simulator HELP path
// reaches `createTwilioClient()` + `sendSms()` from inside
// `ingestInbound`; the messages route reaches them directly. We share
// one set of mocks so both routes behave consistently in a single test.
const sendSmsMock = vi.fn();
const createTwilioClientMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  sendSms: (...args: unknown[]) => sendSmsMock(...args),
  createTwilioClient: () => createTwilioClientMock(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { POST as simulatePOST } from "./route";
import { POST as messagesPOST } from "@/app/api/phone/messages/route";
import { POST as reOptInPOST } from "@/app/api/phone/opt-outs/[id]/re-opt-in/route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

type Row = Record<string, unknown>;

// A persistence-aware service-client fake. Unlike the per-route fakes
// (which only track writes), this one actually mutates the backing
// `tables` so subsequent route calls observe the previous calls' effect
// — the simulator's STOP upsert lands in `phone_opt_outs`, the messages
// route's later opt-out check finds it, the admin re-opt-in route's
// update flips `re_opted_in_at`, and the next send goes through. That
// cross-call state is the whole point of these lifecycle tests.
function makeServiceClient(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {
    phone_numbers: [],
    phone_opt_outs: [],
    phone_conversations: [],
    phone_messages: [],
    organizations: [],
    contacts: [],
    jobs: [],
    ...seed,
  };
  const inserts: { table: string; row: Row }[] = [];
  const upserts: { table: string; row: Row; onConflict?: string }[] = [];
  const updates: { table: string; patch: Row; filters: Row }[] = [];
  let idCounter = 0;
  const nextId = () => `mem-${++idCounter}`;

  function builder(table: string) {
    let working = [...(tables[table] ?? [])];
    const ctx: { filters: Row } = { filters: {} };
    let pendingInsertRow: Row | null = null;
    let pendingUpdatePatch: Row | null = null;

    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.order = () => b;
    b.limit = () => b;
    b.eq = (col: string, val: unknown) => {
      ctx.filters[col] = val;
      working = working.filter((r) => r[col] === val);
      return b;
    };
    b.in = (col: string, vals: unknown[]) => {
      working = working.filter((r) => vals.includes(r[col]));
      return b;
    };
    b.is = (col: string, val: unknown) => {
      working = working.filter((r) => r[col] === val);
      return b;
    };
    b.insert = (row: Row) => {
      const persisted: Row = { id: nextId(), ...row };
      tables[table].push(persisted);
      inserts.push({ table, row });
      pendingInsertRow = persisted;
      return b;
    };
    b.upsert = (row: Row, opts?: { onConflict?: string }) => {
      upserts.push({ table, row, onConflict: opts?.onConflict });
      let matched: Row | null = null;
      if (opts?.onConflict) {
        const conflictCols = opts.onConflict.split(",").map((c) => c.trim());
        matched =
          tables[table].find((existing) =>
            conflictCols.every((col) => existing[col] === row[col]),
          ) ?? null;
      }
      if (matched) {
        Object.assign(matched, row);
        pendingInsertRow = matched;
      } else {
        const persisted: Row = { id: nextId(), ...row };
        tables[table].push(persisted);
        pendingInsertRow = persisted;
      }
      return b;
    };
    b.update = (patch: Row) => {
      pendingUpdatePatch = patch;
      return b;
    };
    b.maybeSingle = async () => ({ data: working[0] ?? null, error: null });
    b.single = async () => {
      if (pendingInsertRow) {
        return { data: pendingInsertRow, error: null };
      }
      return {
        data: working[0] ?? null,
        error: working[0] ? null : { message: "no rows" },
      };
    };
    b.then = (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      if (pendingUpdatePatch) {
        const patch = pendingUpdatePatch;
        for (const r of tables[table]) {
          if (Object.entries(ctx.filters).every(([k, v]) => r[k] === v)) {
            Object.assign(r, patch);
          }
        }
        updates.push({ table, patch, filters: { ...ctx.filters } });
        return resolve({ data: [], error: null });
      }
      return resolve({ data: working, error: null });
    };
    return b;
  }

  return { client: { from: builder }, tables, inserts, upserts, updates };
}

function simulateReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/phone/dev/simulate-inbound", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function messagesReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/phone/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function reOptInReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/phone/opt-outs/oo-1/re-opt-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ORG_ID = "org-1";
const ORG_NAME = "AAA Contracting";
const SHARED_NUM = {
  id: "pn-1",
  organization_id: ORG_ID,
  twilio_sid: "PNshared",
  e164: "+15125550000",
  kind: "shared",
  user_id: null,
  released_at: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};
const CUSTOMER = "+15551234567";

function authedAs(userId: string, role: "admin" | "crew_lead") {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: { id: userId },
      tables: memberTables({
        userId,
        role,
        orgId: ORG_ID,
        grants: role === "crew_lead" ? ["view_phone"] : [],
      }),
    }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue(ORG_ID);
  // The fake Twilio provider returns SM-prefixed SIDs; mirror that so a
  // test asserting on the prefix exercises the same shape the demo runs
  // against. (Slice 15a — `fake-twilio-client.ts`.)
  createTwilioClientMock.mockReturnValue({});
  sendSmsMock.mockImplementation(async () => ({
    sid: `SM${Math.random().toString(16).slice(2, 18)}${Math.random()
      .toString(16)
      .slice(2, 18)}`.slice(0, 34),
    status: "queued",
  }));
  vi.stubEnv("NOOKLEUS_PHONE_DEMO_MODE", "true");
  vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// opt-out-blocks-send — the demoable STOP→refusal lifecycle.
//
// AC: "After a simulated STOP, POST /api/phone/messages to that number
// returns the existing TCPA 403 and does NOT call sendSms / the fake
// provider — this is the demoable STOP→refusal lifecycle (the row is
// created by the simulated STOP, NOT hand-seeded)."
// ---------------------------------------------------------------------------

describe("Phone demo lifecycle — opt-out blocks subsequent send", () => {
  it("simulator STOP records the opt-out; next /api/phone/messages send is refused with 403 and the fake provider is never called", async () => {
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [{ id: "c-1", organization_id: ORG_ID, phone: CUSTOMER }],
      jobs: [],
      organizations: [{ id: ORG_ID, name: ORG_NAME }],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    authedAs("user-lead-1", "crew_lead");

    // Step 1 — the customer texts STOP to the shared number. The
    // simulator path is identical to the real webhook, so this records
    // the org-scoped opt-out for real.
    const stopRes = await simulatePOST(
      simulateReq({ from: CUSTOMER, to: SHARED_NUM.e164, body: "STOP" }),
    );
    expect(stopRes.status).toBe(200);
    expect(sendSmsMock).not.toHaveBeenCalled();

    // Step 2 — a Crew Lead tries to send to that number. The TCPA gate
    // refuses with 403, and the fake provider must never be called.
    const sendRes = await messagesPOST(
      messagesReq({ outsideE164: CUSTOMER, body: "are you there?" }),
      { params: Promise.resolve({}) },
    );
    expect(sendRes.status).toBe(403);
    const body = await sendRes.json();
    expect(body.error).toMatch(/opt(ed|-)?\s*-?\s*out/i);
    expect(sendSmsMock).not.toHaveBeenCalled();
    // No outbound message row written — the refusal must be clean.
    expect(
      inserts.find(
        (i) => i.table === "phone_messages" && i.row.direction === "out",
      ),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// HELP-auto-reply-via-fake — the demoable HELP lifecycle.
//
// AC: "A simulated inbound with body HELP (or INFO) persists the
// inbound row and, when NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED is on,
// dispatches an outbound auto-reply through the fake provider (an SM-
// prefixed SID, no carrier touched); the reply body contains the org
// name + opt-out instructions and is persisted as a direction='out'
// phone_messages row with job_tag null; HELP does NOT record an
// opt-out and is gated by isPhoneOutboundEnabled() exactly as the
// webhook."
// ---------------------------------------------------------------------------

describe("Phone demo lifecycle — HELP auto-reply via fake provider", () => {
  it("dispatches an outbound auto-reply (SM-prefixed SID) with the org name and opt-out instructions, persisted as direction='out' / job_tag=null", async () => {
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [{ id: "c-1", organization_id: ORG_ID, phone: CUSTOMER }],
      // Even with one active job — which would normally smart-attach
      // inbound — the HELP auto-reply must NOT be tagged to it. Auto-
      // replies are system messaging, not part of the Job's
      // conversation thread (`ingest-inbound` sets job_tag: null on the
      // auto-reply row).
      jobs: [
        {
          id: "job-1",
          organization_id: ORG_ID,
          contact_id: "c-1",
          status: "in_progress",
          job_number: "WTR-2026-0001",
        },
      ],
      organizations: [{ id: ORG_ID, name: ORG_NAME }],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await simulatePOST(
      simulateReq({ from: CUSTOMER, to: SHARED_NUM.e164, body: "HELP" }),
    );
    expect(res.status).toBe(200);

    // sendSms went through with the org's number as `from` and the
    // customer as `to`. The body must identify the org and tell the
    // customer how to opt out — these are the two TCPA requirements.
    expect(sendSmsMock).toHaveBeenCalledOnce();
    const sendArgs = sendSmsMock.mock.calls[0][1] as {
      from: string;
      to: string;
      body: string;
    };
    expect(sendArgs.from).toBe(SHARED_NUM.e164);
    expect(sendArgs.to).toBe(CUSTOMER);
    expect(sendArgs.body).toMatch(new RegExp(ORG_NAME, "i"));
    expect(sendArgs.body).toMatch(/STOP/i);

    // The inbound HELP itself is persisted (the customer's question is
    // still part of the thread).
    const inboundMsg = inserts.find(
      (i) => i.table === "phone_messages" && i.row.direction === "in",
    );
    expect(inboundMsg?.row).toMatchObject({
      direction: "in",
      from_e164: CUSTOMER,
      to_e164: SHARED_NUM.e164,
      body: "HELP",
    });

    // The outbound auto-reply is persisted as its own row. Direction
    // is 'out', job_tag is null (system message, not Job-tagged), and
    // the SID carries the fake provider's `SM` prefix — the demo
    // recording is observably running against the in-process fake.
    const outboundMsg = inserts.find(
      (i) => i.table === "phone_messages" && i.row.direction === "out",
    );
    expect(outboundMsg?.row).toMatchObject({
      direction: "out",
      from_e164: SHARED_NUM.e164,
      to_e164: CUSTOMER,
      job_tag: null,
    });
    expect(String(outboundMsg?.row.twilio_sid ?? "")).toMatch(/^SM/);
  });

  it("does NOT record a phone_opt_outs row (HELP is informational, not opt-out)", async () => {
    const { client, upserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [{ id: "c-1", organization_id: ORG_ID, phone: CUSTOMER }],
      jobs: [],
      organizations: [{ id: ORG_ID, name: ORG_NAME }],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await simulatePOST(
      simulateReq({ from: CUSTOMER, to: SHARED_NUM.e164, body: "HELP" }),
    );
    expect(res.status).toBe(200);
    expect(upserts.find((u) => u.table === "phone_opt_outs")).toBeUndefined();
  });

  it("does NOT dispatch the auto-reply when NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED is off (same gate as the webhook)", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [{ id: "c-1", organization_id: ORG_ID, phone: CUSTOMER }],
      jobs: [],
      organizations: [{ id: ORG_ID, name: ORG_NAME }],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await simulatePOST(
      simulateReq({ from: CUSTOMER, to: SHARED_NUM.e164, body: "HELP" }),
    );
    expect(res.status).toBe(200);
    // The inbound row is still persisted (the customer's HELP is part
    // of the thread); only the outbound auto-reply is gated.
    expect(
      inserts.find(
        (i) => i.table === "phone_messages" && i.row.direction === "in",
      ),
    ).toBeDefined();
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(
      inserts.find(
        (i) => i.table === "phone_messages" && i.row.direction === "out",
      ),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// re-opt-in-then-send-succeeds — the full opt-out lifecycle is demoable.
//
// AC: "Re-opt-in via the existing Settings → Phone re-opt-in route
// clears the block (re_opted_in_at set) so a subsequent demo send to
// that number succeeds — the full opt-out lifecycle is demoable."
//
// The re-opt-in route is admin-only — a crew_lead cannot flip the
// gate; the test uses an admin to clear it and then a crew_lead to
// send, mirroring the production access matrix.
// ---------------------------------------------------------------------------

describe("Phone demo lifecycle — admin re-opt-in unblocks subsequent send", () => {
  it("simulator STOP → admin re-opt-in → crew_lead send succeeds (201)", async () => {
    const { client, tables, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [{ id: "c-1", organization_id: ORG_ID, phone: CUSTOMER }],
      jobs: [],
      organizations: [{ id: ORG_ID, name: ORG_NAME }],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    // Step 1 — STOP records the opt-out (same path as the webhook).
    authedAs("user-lead-1", "crew_lead");
    const stopRes = await simulatePOST(
      simulateReq({ from: CUSTOMER, to: SHARED_NUM.e164, body: "STOP" }),
    );
    expect(stopRes.status).toBe(200);
    const optOutRow = tables.phone_opt_outs.find(
      (r) => r.outside_e164 === CUSTOMER && r.organization_id === ORG_ID,
    );
    expect(optOutRow).toBeDefined();
    expect(optOutRow?.re_opted_in_at).toBeNull();
    const optOutId = optOutRow?.id as string;

    // Step 2 — an admin re-opts the customer in via the existing
    // Settings → Phone admin route. The note is the required audit
    // trail of fresh consent.
    authedAs("admin-1", "admin");
    const reOptRes = await reOptInPOST(reOptInReq({ note: "Fresh consent on call" }), {
      params: Promise.resolve({ id: optOutId }),
    });
    expect(reOptRes.status).toBe(200);
    // `re_opted_in_at` is now set, so the messages route's
    // `.is('re_opted_in_at', null)` opt-out check filters this row out.
    const refreshed = tables.phone_opt_outs.find((r) => r.id === optOutId);
    expect(refreshed?.re_opted_in_at).not.toBeNull();

    // Step 3 — a crew_lead sends, and the gate is open again.
    authedAs("user-lead-1", "crew_lead");
    const sendRes = await messagesPOST(
      messagesReq({ outsideE164: CUSTOMER, body: "Welcome back!" }),
      { params: Promise.resolve({}) },
    );
    expect(sendRes.status).toBe(201);
    expect(sendSmsMock).toHaveBeenCalledOnce();
    const outboundMsg = inserts.find(
      (i) =>
        i.table === "phone_messages" &&
        i.row.direction === "out" &&
        i.row.body === "Welcome back!",
    );
    expect(outboundMsg?.row).toMatchObject({
      from_e164: SHARED_NUM.e164,
      to_e164: CUSTOMER,
      sent_by_user_id: "user-lead-1",
    });
  });
});
