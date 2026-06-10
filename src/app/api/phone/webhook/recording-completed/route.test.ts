// PRD #304 — Nookleus Phone. Slice 11 (#315) — recording-completed webhook.
//
// Twilio POSTs here when an answered call's <Dial record> finishes (the
// inbound voice webhook and the outbound bridge wire this as the dial's
// recordingStatusCallback). The callback carries:
//   CallSid           — matches the `twilio_call_sid` we stored on phone_calls
//   RecordingSid      — Twilio's handle for the recording (RE...)
//   RecordingUrl      — the Twilio-hosted media URL
//   RecordingDuration — length in seconds
//
// The route looks up the parent phone_calls row by CallSid (to inherit its
// org + id) and inserts a phone_recordings row with consent_notice_played=true
// (the consent notice always fires when recording is enabled — the boolean is
// the audit-trail record). It then copies the audio out of Twilio into the
// phone-recordings bucket. Unauthenticated; gated solely by X-Twilio-Signature.
// Service-client writes — no auth user, so RLS would otherwise refuse.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

function makeServiceClient(
  seed: Record<string, Row[]>,
  opts: { uploadError?: { message: string } } = {},
) {
  const tables: Record<string, Row[]> = {
    phone_calls: [],
    phone_recordings: [],
    ...seed,
  };
  const inserts: { table: string; row: Row; onConflict?: string }[] = [];
  const updates: { table: string; patch: Row; filters: Row }[] = [];
  const uploads: { path: string; options: unknown }[] = [];

  function builder(table: string) {
    let rows = tables[table] ?? [];
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
      return b;
    };
    b.upsert = (row: Row, opt?: { onConflict?: string }) => {
      pendingInsert = row;
      inserts.push({ table, row, onConflict: opt?.onConflict });
      return b;
    };
    b.update = (patch: Row) => {
      pendingUpdate = patch;
      return b;
    };
    b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    b.then = (resolve: (v: { data: unknown; error: null }) => unknown) => {
      if (pendingUpdate) {
        updates.push({ table, patch: pendingUpdate, filters: { ...ctx.filters } });
        return resolve({ data: null, error: null });
      }
      if (pendingInsert) return resolve({ data: null, error: null });
      return resolve({ data: rows, error: null });
    };
    return b;
  }

  const storage = {
    from: () => ({
      upload: async (path: string, _body: unknown, uploadOpts: unknown) => {
        uploads.push({ path, options: uploadOpts });
        return { data: opts.uploadError ? null : { path }, error: opts.uploadError ?? null };
      },
      createSignedUrl: async (path: string) => ({
        data: { signedUrl: `https://signed.example/${path}` },
        error: null,
      }),
    }),
  };

  return { client: { from: builder, storage }, tables, inserts, updates, uploads };
}

function recForm(opts: {
  CallSid?: string;
  RecordingSid?: string;
  RecordingUrl?: string;
  RecordingDuration?: string;
}): Request {
  const params = new URLSearchParams();
  if (opts.CallSid !== undefined) params.set("CallSid", opts.CallSid);
  if (opts.RecordingSid !== undefined) params.set("RecordingSid", opts.RecordingSid);
  if (opts.RecordingUrl !== undefined) params.set("RecordingUrl", opts.RecordingUrl);
  if (opts.RecordingDuration !== undefined)
    params.set("RecordingDuration", opts.RecordingDuration);
  return new Request("http://test/api/phone/webhook/recording-completed", {
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/phone/webhook/recording-completed — persist (tracer)", () => {
  it("inserts a phone_recordings row with consent_notice_played=true, keyed to the parent call", async () => {
    const { client, inserts } = makeServiceClient({
      phone_calls: [
        { id: "call-1", organization_id: "org-1", twilio_call_sid: "CA-1" },
      ],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      recForm({
        CallSid: "CA-1",
        RecordingSid: "RE-1",
        RecordingUrl: "https://api.twilio.com/2010-04-01/Recordings/RE-1",
        RecordingDuration: "42",
      }),
    );

    expect(res.status).toBe(200);
    const ins = inserts.find((i) => i.table === "phone_recordings");
    expect(ins).toBeDefined();
    expect(ins!.row).toMatchObject({
      phone_call_id: "call-1",
      organization_id: "org-1",
      twilio_recording_sid: "RE-1",
      twilio_recording_url: "https://api.twilio.com/2010-04-01/Recordings/RE-1",
      duration_seconds: 42,
      consent_notice_played: true,
    });
  });
});

describe("POST /api/phone/webhook/recording-completed — signature + guards", () => {
  it("returns 403 when the Twilio signature is invalid", async () => {
    validateSignatureMock.mockReturnValue(false);
    const { client, inserts } = makeServiceClient({});
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(recForm({ CallSid: "CA-1", RecordingSid: "RE-1" }));

    expect(res.status).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  it("returns 400 when CallSid is missing", async () => {
    const { client, inserts } = makeServiceClient({});
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(recForm({ RecordingSid: "RE-1" }));

    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("returns 200 and inserts nothing when CallSid matches no call (silent drop)", async () => {
    const { client, inserts } = makeServiceClient({ phone_calls: [] });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(recForm({ CallSid: "CA-unknown", RecordingSid: "RE-1" }));

    expect(res.status).toBe(200);
    expect(inserts.find((i) => i.table === "phone_recordings")).toBeUndefined();
  });

  it("is idempotent — upserts on the phone_call_id unique key so a Twilio retry can't violate it", async () => {
    const { client, inserts } = makeServiceClient({
      phone_calls: [
        { id: "call-1", organization_id: "org-1", twilio_call_sid: "CA-1" },
      ],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(recForm({ CallSid: "CA-1", RecordingSid: "RE-1" }));

    expect(res.status).toBe(200);
    const ins = inserts.find((i) => i.table === "phone_recordings");
    expect(ins).toBeDefined();
    expect(ins!.onConflict).toBe("phone_call_id");
  });
});

describe("POST /api/phone/webhook/recording-completed — audio copy", () => {
  it("fetches the Twilio MP3, uploads it to phone-recordings, and sets audio_storage_path", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { client, updates, uploads } = makeServiceClient({
      phone_calls: [
        { id: "call-1", organization_id: "org-1", twilio_call_sid: "CA-1" },
      ],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      recForm({
        CallSid: "CA-1",
        RecordingSid: "RE-1",
        RecordingUrl: "https://api.twilio.com/2010-04-01/Recordings/RE-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      "https://api.twilio.com/2010-04-01/Recordings/RE-1.mp3",
    );
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toMatch(/^org-1\/[0-9a-f-]+\.mp3$/);
    const upd = updates.find((u) => u.table === "phone_recordings");
    expect(upd).toBeDefined();
    expect(upd!.filters).toMatchObject({ phone_call_id: "call-1" });
    expect(upd!.patch.audio_storage_path).toEqual(uploads[0].path);
  });

  it("skips the copy on a redelivery whose recording already has audio_storage_path (no orphan upload)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { client, uploads, updates } = makeServiceClient({
      phone_calls: [
        { id: "call-1", organization_id: "org-1", twilio_call_sid: "CA-1" },
      ],
      phone_recordings: [
        {
          phone_call_id: "call-1",
          organization_id: "org-1",
          audio_storage_path: "org-1/already-copied.mp3",
        },
      ],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      recForm({
        CallSid: "CA-1",
        RecordingSid: "RE-1",
        RecordingUrl: "https://api.twilio.com/2010-04-01/Recordings/RE-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
    expect(
      updates.find(
        (u) => u.table === "phone_recordings" && "audio_storage_path" in u.patch,
      ),
    ).toBeUndefined();
  });

  it("swallows a copy failure — the row still persists with no audio_storage_path update", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const { client, inserts, updates } = makeServiceClient({
      phone_calls: [
        { id: "call-1", organization_id: "org-1", twilio_call_sid: "CA-1" },
      ],
    });
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      recForm({
        CallSid: "CA-1",
        RecordingSid: "RE-1",
        RecordingUrl: "https://api.twilio.com/2010-04-01/Recordings/RE-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(inserts.find((i) => i.table === "phone_recordings")).toBeDefined();
    expect(
      updates.find(
        (u) => u.table === "phone_recordings" && "audio_storage_path" in u.patch,
      ),
    ).toBeUndefined();
  });
});
