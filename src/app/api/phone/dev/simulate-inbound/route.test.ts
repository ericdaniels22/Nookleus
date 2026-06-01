// PRD #304 — Nookleus Phone. Slice 15 (#368) — dev simulate-inbound route.
//
// `POST /api/phone/dev/simulate-inbound` is the dev-only inbound simulator
// for Phone demo / dev mode. When `NOOKLEUS_PHONE_DEMO_MODE === 'true'`,
// it resolves the org Shared/Personal number from `to`, loads the org's
// Contacts + Active jobs (real DB reads, same as the webhook), calls the
// pure `routeInbound()` to get the routing decision, then calls
// `ingestInbound()`. When the flag is off, the route 404s — the surface
// does not exist in production.
//
// Tests assert observable behavior: the rows that land in the DB and the
// status code the route returns. The pure modules (route-inbound,
// smart-attach, opt-out-registry) are NOT mocked — they exercise the
// real decision logic.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendSmsMock = vi.fn();
const createTwilioClientMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  sendSms: (...args: unknown[]) => sendSmsMock(...args),
  createTwilioClient: () => createTwilioClientMock(),
}));

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
    client: { from: builder },
    inserts,
    upserts,
    updates,
  };
}

function simulateReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/phone/dev/simulate-inbound", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SHARED_NUM = {
  id: "pn-1",
  organization_id: "org-1",
  e164: "+15125550000",
  kind: "shared",
  user_id: null,
  released_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  sendSmsMock.mockResolvedValue({ sid: "SM-auto", status: "queued" });
  createTwilioClientMock.mockReturnValue({});
  // The outbound feature flag is independent; it gates the HELP
  // auto-reply but not the simulator itself. Default ON for these
  // tests — the flag-off case for HELP is covered in ingest-inbound.test.ts.
  vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Hard 404 unless demo mode is on. This is the route's safety property —
// the surface must not exist in production, full stop. The createTwilioClient
// factory has its own production fail-safe (it throws under NODE_ENV=production
// when the flag is set); this 404 is the routing-layer guarantee that
// stops the request before any code runs.
// ---------------------------------------------------------------------------

describe("POST /api/phone/dev/simulate-inbound — 404 unless demo mode", () => {
  it("returns 404 when NOOKLEUS_PHONE_DEMO_MODE is not 'true'", async () => {
    vi.stubEnv("NOOKLEUS_PHONE_DEMO_MODE", "");
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      simulateReq({
        from: "+15551234567",
        to: "+15125550000",
        body: "hi from the demo",
      }),
    );

    expect(res.status).toBe(404);
    expect(inserts).toHaveLength(0);
  });

  it("returns 404 when NOOKLEUS_PHONE_DEMO_MODE is 'false'", async () => {
    vi.stubEnv("NOOKLEUS_PHONE_DEMO_MODE", "false");
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      simulateReq({ from: "+15551234567", to: "+15125550000", body: "hi" }),
    );

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Demo-mode inbound — the simulator delegates to the same `ingestInbound`
// helper as the real webhook, so smart-attach, threading, and STOP/HELP
// all behave exactly as they do for a real Twilio inbound.
// ---------------------------------------------------------------------------

describe("POST /api/phone/dev/simulate-inbound — happy path with demo mode on", () => {
  beforeEach(() => {
    vi.stubEnv("NOOKLEUS_PHONE_DEMO_MODE", "true");
  });

  it("auto-tags the message when the inbound is from a Contact with exactly one Active job", async () => {
    const { client, inserts, upserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [{ id: "c-1", organization_id: "org-1", phone: "+15551234567" }],
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          contact_id: "c-1",
          status: "in_progress",
          job_number: "WTR-2026-0001",
        },
      ],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      simulateReq({
        from: "+15551234567",
        to: "+15125550000",
        body: "on my way",
      }),
    );

    expect(res.status).toBe(200);
    const conv = upserts.find((u) => u.table === "phone_conversations");
    expect(conv?.row).toMatchObject({
      organization_id: "org-1",
      phone_number_id: "pn-1",
      outside_e164: "+15551234567",
    });
    const msg = inserts.find((i) => i.table === "phone_messages");
    expect(msg?.row).toMatchObject({
      direction: "in",
      from_e164: "+15551234567",
      to_e164: "+15125550000",
      body: "on my way",
      job_tag: "job-1",
    });
  });

  it("leaves job_tag null when the Contact has 2+ Active jobs (prompt branch)", async () => {
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [{ id: "c-1", organization_id: "org-1", phone: "+15551234567" }],
      jobs: [
        { id: "job-1", organization_id: "org-1", contact_id: "c-1", status: "in_progress", job_number: "WTR-2026-0001" },
        { id: "job-2", organization_id: "org-1", contact_id: "c-1", status: "new", job_number: "FYR-2026-0005" },
      ],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      simulateReq({ from: "+15551234567", to: "+15125550000", body: "hi" }),
    );

    expect(res.status).toBe(200);
    const msg = inserts.find((i) => i.table === "phone_messages");
    expect(msg?.row.job_tag).toBeNull();
  });

  it("leaves job_tag null for an inbound from an unknown number (no matching Contact)", async () => {
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      simulateReq({
        from: "+15559999999",
        to: "+15125550000",
        body: "is this you?",
      }),
    );

    expect(res.status).toBe(200);
    const msg = inserts.find((i) => i.table === "phone_messages");
    expect(msg?.row).toMatchObject({
      direction: "in",
      from_e164: "+15559999999",
      body: "is this you?",
      job_tag: null,
    });
  });

  it("returns 404 when the `to` address does not match any org's phone number", async () => {
    const { client, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      simulateReq({
        from: "+15551234567",
        to: "+19999999999",
        body: "wrong number",
      }),
    );

    expect(res.status).toBe(404);
    expect(inserts).toHaveLength(0);
  });

  it("writes a phone_opt_outs row on STOP body (same path as real webhook)", async () => {
    const { client, upserts, inserts } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [{ id: "c-1", organization_id: "org-1", phone: "+15551234567" }],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      simulateReq({
        from: "+15551234567",
        to: "+15125550000",
        body: "STOP",
      }),
    );

    expect(res.status).toBe(200);
    const oo = upserts.find((u) => u.table === "phone_opt_outs");
    expect(oo?.row).toMatchObject({
      organization_id: "org-1",
      outside_e164: "+15551234567",
    });
    // The STOP message itself is still persisted (the audit trail).
    const msg = inserts.find((i) => i.table === "phone_messages");
    expect(msg?.row).toMatchObject({ direction: "in", body: "STOP" });
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Body validation — the route accepts JSON `{ from, to, body, mediaUrls? }`
// and rejects malformed input with 400.
// ---------------------------------------------------------------------------

describe("POST /api/phone/dev/simulate-inbound — body validation", () => {
  beforeEach(() => {
    vi.stubEnv("NOOKLEUS_PHONE_DEMO_MODE", "true");
  });

  it("returns 400 when from is missing or not a valid US phone", async () => {
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      simulateReq({ to: "+15125550000", body: "hi" }),
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 when to is missing", async () => {
    const { client } = makeServiceClient({
      phone_numbers: [SHARED_NUM],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      simulateReq({ from: "+15551234567", body: "hi" }),
    );

    expect(res.status).toBe(400);
  });
});
