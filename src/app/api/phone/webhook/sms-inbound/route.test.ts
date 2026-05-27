// PRD #304 — Nookleus Phone. Slice 4 (#308).
//
// Tests for the inbound-SMS webhook route. Twilio calls this URL when a
// customer texts one of our numbers. The route:
//   1. Validates X-Twilio-Signature.
//   2. Parses the form-encoded payload (Twilio sends application/x-www-form-urlencoded).
//   3. Queries the org's phone_numbers, contacts, jobs via the Service client.
//   4. Calls route-inbound (pure) for the routing decision.
//   5. Upserts a phone_conversations row, inserts a phone_messages row,
//      bumps last_event_at + unread_count.
//   6. Returns TwiML (<Response/>) with 200.
//
// Twilio and Supabase are mocked at the module boundary. The pure routing
// modules are NOT mocked — they exercise the real decision logic.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const validateSignatureMock = vi.fn();
const sendSmsModuleMock = vi.fn();
const createTwilioClientModuleMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  validateTwilioSignature: (...args: unknown[]) => validateSignatureMock(...args),
  sendSms: (...args: unknown[]) => sendSmsModuleMock(...args),
  createTwilioClient: () => createTwilioClientModuleMock(),
}));

const createServiceClientMock = vi.fn();
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: () => createServiceClientMock(),
}));

import { POST } from "./route";

interface Row { [key: string]: unknown }

interface BuilderTables {
  phone_numbers: Row[];
  contacts: Row[];
  jobs: Row[];
  phone_conversations: Row[];
  phone_messages: Row[];
  phone_opt_outs?: Row[];
  organizations?: Row[];
}

function makeServiceClient(tables: BuilderTables) {
  // Records every insert / upsert so tests can assert on them. The
  // builder is intentionally small — eq filtering, maybeSingle, single,
  // insert(...).select().single(), upsert(...).select().single().
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

function inboundForm(opts: {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
}): { req: Request; bodyString: string } {
  const params = new URLSearchParams();
  params.set("From", opts.From ?? "+15551234567");
  params.set("To", opts.To ?? "+15125550000");
  params.set("Body", opts.Body ?? "hello");
  params.set("MessageSid", opts.MessageSid ?? "SM-abc");
  const bodyString = params.toString();
  const req = new Request("http://test/api/phone/webhook/sms-inbound", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "valid-sig",
    },
    body: bodyString,
  });
  return { req, bodyString };
}

beforeEach(() => {
  vi.clearAllMocks();
  validateSignatureMock.mockReturnValue(true);
  // The HELP auto-reply branch is gated on the #309 feature flag.
  // Default each test to flag-ON so the existing inbound matrix runs
  // unchanged; the flag-OFF case has its own dedicated test below.
  vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/phone/webhook/sms-inbound — signature validation", () => {
  it("returns 403 when the X-Twilio-Signature header is missing or invalid", async () => {
    validateSignatureMock.mockReturnValue(false);
    const { client } = makeServiceClient({
      phone_numbers: [],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
    });
    createServiceClientMock.mockReturnValue(client);

    const { req } = inboundForm({});
    const res = await POST(req);

    expect(res.status).toBe(403);
  });
});

describe("POST /api/phone/webhook/sms-inbound — happy path", () => {
  it("returns 200 with TwiML when the To address matches no org number (Twilio expects 200 either way)", async () => {
    const { client } = makeServiceClient({
      phone_numbers: [],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
    });
    createServiceClientMock.mockReturnValue(client);

    const { req } = inboundForm({ To: "+19999999999" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/xml/);
    expect(await res.text()).toContain("<Response");
  });

  it("inserts a conversation + message for an inbound from an unknown number", async () => {
    const { client, upserts, inserts } = makeServiceClient({
      phone_numbers: [
        {
          id: "pn-1",
          organization_id: "org-1",
          e164: "+15125550000",
          kind: "shared",
          user_id: null,
          released_at: null,
        },
      ],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
    });
    createServiceClientMock.mockReturnValue(client);

    const { req } = inboundForm({
      From: "+15551234567",
      To: "+15125550000",
      Body: "Hello!",
      MessageSid: "SMabc",
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
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
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      table: "phone_messages",
      row: {
        organization_id: "org-1",
        direction: "in",
        from_e164: "+15551234567",
        to_e164: "+15125550000",
        body: "Hello!",
        twilio_sid: "SMabc",
        job_tag: null,
      },
    });
  });

  it("auto-tags the message when the inbound is from a Contact with exactly one Active job", async () => {
    const { client, inserts } = makeServiceClient({
      phone_numbers: [
        {
          id: "pn-1",
          organization_id: "org-1",
          e164: "+15125550000",
          kind: "shared",
          user_id: null,
          released_at: null,
        },
      ],
      contacts: [
        {
          id: "c-1",
          organization_id: "org-1",
          phone: "(555) 123-4567",
        },
      ],
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
    });
    createServiceClientMock.mockReturnValue(client);

    const { req } = inboundForm({
      From: "+15551234567",
      To: "+15125550000",
      Body: "On my way",
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const msg = inserts.find((i) => i.table === "phone_messages");
    expect(msg).toBeDefined();
    expect(msg!.row).toMatchObject({
      job_tag: "job-1",
      tagged_by_user_id: null, // auto-tagged
    });
  });

  it("leaves job_tag null when the contact has 2+ Active jobs (prompt branch)", async () => {
    const { client, inserts } = makeServiceClient({
      phone_numbers: [
        {
          id: "pn-1",
          organization_id: "org-1",
          e164: "+15125550000",
          kind: "shared",
          user_id: null,
          released_at: null,
        },
      ],
      contacts: [
        { id: "c-1", organization_id: "org-1", phone: "5551234567" },
      ],
      jobs: [
        { id: "job-1", organization_id: "org-1", contact_id: "c-1", status: "in_progress", job_number: "WTR-2026-0001" },
        { id: "job-2", organization_id: "org-1", contact_id: "c-1", status: "new", job_number: "FYR-2026-0005" },
      ],
      phone_conversations: [],
      phone_messages: [],
    });
    createServiceClientMock.mockReturnValue(client);

    const { req } = inboundForm({ From: "+15551234567" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const msg = inserts.find((i) => i.table === "phone_messages");
    expect(msg!.row.job_tag).toBeNull();
  });

  it("ignores Completed and Cancelled jobs when collecting Active jobs", async () => {
    // The smart-attach module receives `activeJobs`; the webhook is
    // responsible for filtering jobs by `status NOT IN ('completed',
    // 'cancelled')` before passing them in. A contact with 1 Active +
    // 1 Completed job is auto-tagged to the Active job.
    const { client, inserts } = makeServiceClient({
      phone_numbers: [
        {
          id: "pn-1",
          organization_id: "org-1",
          e164: "+15125550000",
          kind: "shared",
          user_id: null,
          released_at: null,
        },
      ],
      contacts: [
        { id: "c-1", organization_id: "org-1", phone: "+15551234567" },
      ],
      jobs: [
        { id: "job-1", organization_id: "org-1", contact_id: "c-1", status: "completed", job_number: "WTR-2026-0001" },
        { id: "job-2", organization_id: "org-1", contact_id: "c-1", status: "in_progress", job_number: "FYR-2026-0005" },
      ],
      phone_conversations: [],
      phone_messages: [],
    });
    createServiceClientMock.mockReturnValue(client);

    const { req } = inboundForm({ From: "+15551234567" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const msg = inserts.find((i) => i.table === "phone_messages");
    expect(msg!.row.job_tag).toBe("job-2");
  });
});

// ---------------------------------------------------------------------------
// Slice 5 (#309) — TCPA STOP / HELP handling on the inbound path.
//
// AC bullets:
//   - "An inbound STOP / UNSUBSCRIBE / END / QUIT / CANCEL / STOPALL writes
//      a phone_opt_outs row; subsequent outbound attempts to that number
//      from any number in the org are blocked"
//   - "An inbound HELP / INFO triggers an outbound auto-reply identifying
//      the Organization (org name + how to opt out)"
//
// Wiring: the inbound webhook detects the classifier verdict and:
//   - STOP-side: upserts into phone_opt_outs by (org, outside_e164) BEFORE
//     persisting the message. The message row itself still lands in the
//     thread (the customer's STOP is the record of why they opted out).
//   - HELP-side: writes the inbound row, then dispatches an outbound
//     auto-reply via Twilio with the org's name. The auto-reply is logged
//     as its own outbound `phone_messages` row.
// ---------------------------------------------------------------------------

describe("inbound STOP — opt-out registry", () => {
  beforeEach(() => {
    sendSmsModuleMock.mockResolvedValue({ sid: "SM-auto", status: "queued" });
    createTwilioClientModuleMock.mockReturnValue({});
  });

  it("writes a phone_opt_outs row on inbound STOP and still records the message", async () => {
    const { client, upserts, inserts } = makeServiceClient({
      phone_numbers: [
        {
          id: "num-1",
          organization_id: "org-1",
          e164: "+15125550000",
          kind: "shared",
          user_id: null,
          released_at: null,
        },
      ],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const { req } = inboundForm({
      From: "+15551234567",
      Body: "STOP",
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    // Opt-out registry row was written.
    const oo = upserts.find((u) => u.table === "phone_opt_outs");
    expect(oo).toBeDefined();
    expect(oo?.row).toMatchObject({
      organization_id: "org-1",
      outside_e164: "+15551234567",
    });
    // The message itself is still persisted (the customer's STOP is the
    // record).
    const msg = inserts.find((i) => i.table === "phone_messages");
    expect(msg?.row).toMatchObject({ direction: "in", body: "STOP" });
    // STOP does NOT trigger an auto-reply (Twilio itself handles
    // STOP confirmation per A2P 10DLC carrier rules).
    expect(sendSmsModuleMock).not.toHaveBeenCalled();
  });

  it("upserts opt-out idempotently when STOP arrives twice", async () => {
    const { client, upserts } = makeServiceClient({
      phone_numbers: [
        {
          id: "num-1",
          organization_id: "org-1",
          e164: "+15125550000",
          kind: "shared",
          user_id: null,
          released_at: null,
        },
      ],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [
        {
          id: "oo-existing",
          organization_id: "org-1",
          outside_e164: "+15551234567",
        },
      ],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const { req } = inboundForm({
      From: "+15551234567",
      Body: "unsubscribe",
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const oo = upserts.find((u) => u.table === "phone_opt_outs");
    expect(oo?.onConflict).toContain("organization_id");
    expect(oo?.onConflict).toContain("outside_e164");
  });

  it("recognises every CTIA STOP synonym", async () => {
    const synonyms = ["STOP", "UNSUBSCRIBE", "END", "QUIT", "CANCEL", "STOPALL"];
    for (const word of synonyms) {
      const { client, upserts } = makeServiceClient({
        phone_numbers: [
          {
            id: "num-1",
            organization_id: "org-1",
            e164: "+15125550000",
            kind: "shared",
            user_id: null,
            released_at: null,
          },
        ],
        contacts: [],
        jobs: [],
        phone_conversations: [],
        phone_messages: [],
        phone_opt_outs: [],
        organizations: [{ id: "org-1", name: "AAA Contracting" }],
      });
      createServiceClientMock.mockReturnValue(client);

      const { req } = inboundForm({ Body: word });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(upserts.find((u) => u.table === "phone_opt_outs")).toBeDefined();
    }
  });
});

describe("inbound HELP — auto-reply with org name", () => {
  beforeEach(() => {
    sendSmsModuleMock.mockResolvedValue({ sid: "SM-auto", status: "queued" });
    createTwilioClientModuleMock.mockReturnValue({});
  });

  it("dispatches an outbound auto-reply identifying the org on inbound HELP", async () => {
    const { client, inserts } = makeServiceClient({
      phone_numbers: [
        {
          id: "num-1",
          organization_id: "org-1",
          e164: "+15125550000",
          kind: "shared",
          user_id: null,
          released_at: null,
        },
      ],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const { req } = inboundForm({ From: "+15551234567", Body: "HELP" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(sendSmsModuleMock).toHaveBeenCalledOnce();
    const sendArgs = sendSmsModuleMock.mock.calls[0][1] as {
      from: string;
      to: string;
      body: string;
    };
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

  it("recognises HELP and INFO synonyms", async () => {
    for (const word of ["HELP", "INFO", "help", "info"]) {
      sendSmsModuleMock.mockClear();
      const { client } = makeServiceClient({
        phone_numbers: [
          {
            id: "num-1",
            organization_id: "org-1",
            e164: "+15125550000",
            kind: "shared",
            user_id: null,
            released_at: null,
          },
        ],
        contacts: [],
        jobs: [],
        phone_conversations: [],
        phone_messages: [],
        phone_opt_outs: [],
        organizations: [{ id: "org-1", name: "AAA Contracting" }],
      });
      createServiceClientMock.mockReturnValue(client);

      const { req } = inboundForm({ Body: word });
      await POST(req);

      expect(sendSmsModuleMock).toHaveBeenCalledOnce();
    }
  });

  it("does not auto-reply for ordinary inbound messages", async () => {
    const { client } = makeServiceClient({
      phone_numbers: [
        {
          id: "num-1",
          organization_id: "org-1",
          e164: "+15125550000",
          kind: "shared",
          user_id: null,
          released_at: null,
        },
      ],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const { req } = inboundForm({ Body: "hello, can you come tuesday" });
    await POST(req);

    expect(sendSmsModuleMock).not.toHaveBeenCalled();
  });
});

describe("inbound HELP — gated by #309 feature flag", () => {
  it("does NOT dispatch the auto-reply when NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    sendSmsModuleMock.mockResolvedValue({ sid: "SM-auto", status: "queued" });
    createTwilioClientModuleMock.mockReturnValue({});

    const { client } = makeServiceClient({
      phone_numbers: [
        {
          id: "num-1",
          organization_id: "org-1",
          e164: "+15125550000",
          kind: "shared",
          user_id: null,
          released_at: null,
        },
      ],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const { req } = inboundForm({ Body: "HELP" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    // STOP-side persistence still happens regardless of flag (the inbound
    // record is still written), but the outbound auto-reply is gated.
    expect(sendSmsModuleMock).not.toHaveBeenCalled();
  });

  it("STILL writes the phone_opt_outs row on inbound STOP when the flag is off", async () => {
    // The STOP path is inbound-only — no outbound SMS is involved — so
    // it must keep working even when the outbound flag is off. The
    // registry needs to be ready the moment the flag flips.
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    sendSmsModuleMock.mockResolvedValue({ sid: "SM-auto", status: "queued" });
    createTwilioClientModuleMock.mockReturnValue({});

    const { client, upserts } = makeServiceClient({
      phone_numbers: [
        {
          id: "num-1",
          organization_id: "org-1",
          e164: "+15125550000",
          kind: "shared",
          user_id: null,
          released_at: null,
        },
      ],
      contacts: [],
      jobs: [],
      phone_conversations: [],
      phone_messages: [],
      phone_opt_outs: [],
      organizations: [{ id: "org-1", name: "AAA Contracting" }],
    });
    createServiceClientMock.mockReturnValue(client);

    const { req } = inboundForm({ Body: "STOP" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(upserts.find((u) => u.table === "phone_opt_outs")).toBeDefined();
    expect(sendSmsModuleMock).not.toHaveBeenCalled();
  });
});
