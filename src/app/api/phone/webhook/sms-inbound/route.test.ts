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

interface Row { [key: string]: unknown }

interface BuilderTables {
  phone_numbers: Row[];
  contacts: Row[];
  jobs: Row[];
  phone_conversations: Row[];
  phone_messages: Row[];
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
