// PRD #304 — Nookleus Phone. Slice 9 (#313) — transcription-completed webhook.
//
// Twilio POSTs here when the <Record transcribe> auto-transcription finishes
// (the inbound-voice webhook wires this as the recording's transcribeCallback).
// The callback carries:
//   RecordingSid       — matches the `twilio_recording_sid` on phone_voicemails
//   TranscriptionText   — the transcript (present when status is 'completed')
//   TranscriptionStatus — 'completed' | 'failed'
//
// The route updates the voicemail row matched by RecordingSid: on success
// transcript = TranscriptionText, transcript_status = 'ready'; on failure
// transcript_status = 'failed' (transcript stays null) — slice 6.
//
// Unauthenticated; gated solely by X-Twilio-Signature. Service-client UPDATE —
// no auth user, so RLS would otherwise refuse.

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

function makeServiceClient() {
  const updates: { table: string; patch: Row; filters: Row }[] = [];

  function builder(table: string) {
    const ctx: { filters: Row } = { filters: {} };
    let pendingUpdate: Row | null = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      ctx.filters[col] = val;
      return b;
    };
    b.update = (patch: Row) => {
      pendingUpdate = patch;
      return b;
    };
    b.then = (resolve: (v: { data: unknown; error: null }) => unknown) => {
      if (pendingUpdate) {
        updates.push({ table, patch: pendingUpdate, filters: { ...ctx.filters } });
        return resolve({ data: null, error: null });
      }
      return resolve({ data: [], error: null });
    };
    return b;
  }

  return { client: { from: builder }, updates };
}

function trForm(opts: {
  RecordingSid?: string;
  TranscriptionText?: string;
  TranscriptionStatus?: string;
}): Request {
  const params = new URLSearchParams();
  if (opts.RecordingSid !== undefined) params.set("RecordingSid", opts.RecordingSid);
  if (opts.TranscriptionText !== undefined)
    params.set("TranscriptionText", opts.TranscriptionText);
  if (opts.TranscriptionStatus !== undefined)
    params.set("TranscriptionStatus", opts.TranscriptionStatus);
  return new Request("http://test/api/phone/webhook/transcription-completed", {
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

describe("POST /api/phone/webhook/transcription-completed — ready (tracer)", () => {
  it("sets transcript + transcript_status='ready' on the voicemail matched by RecordingSid", async () => {
    const { client, updates } = makeServiceClient();
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      trForm({
        RecordingSid: "RE-1",
        TranscriptionText: "Hi, please call me back about the roof.",
        TranscriptionStatus: "completed",
      }),
    );

    expect(res.status).toBe(200);
    const upd = updates.find((u) => u.table === "phone_voicemails");
    expect(upd).toBeDefined();
    expect(upd!.filters).toMatchObject({ twilio_recording_sid: "RE-1" });
    expect(upd!.patch).toMatchObject({
      transcript: "Hi, please call me back about the roof.",
      transcript_status: "ready",
    });
  });
});

describe("POST /api/phone/webhook/transcription-completed — failed", () => {
  it("sets transcript_status='failed' and leaves transcript null when TranscriptionStatus is 'failed'", async () => {
    const { client, updates } = makeServiceClient();
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      trForm({
        RecordingSid: "RE-1",
        // Twilio may still send a partial/garbage TranscriptionText on failure;
        // we must NOT persist it.
        TranscriptionText: "garbled partial",
        TranscriptionStatus: "failed",
      }),
    );

    expect(res.status).toBe(200);
    const upd = updates.find((u) => u.table === "phone_voicemails");
    expect(upd!.filters).toMatchObject({ twilio_recording_sid: "RE-1" });
    expect(upd!.patch).toMatchObject({
      transcript: null,
      transcript_status: "failed",
    });
  });
});

describe("POST /api/phone/webhook/transcription-completed — non-failed statuses default to ready", () => {
  it("a 'completed' callback with no TranscriptionText lands transcript null at status 'ready' (not 'failed')", async () => {
    const { client, updates } = makeServiceClient();
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      trForm({ RecordingSid: "RE-1", TranscriptionStatus: "completed" }),
    );

    expect(res.status).toBe(200);
    const upd = updates.find((u) => u.table === "phone_voicemails");
    expect(upd!.patch).toMatchObject({
      transcript: null,
      transcript_status: "ready",
    });
  });

  it("never marks 'failed' unless TranscriptionStatus is the exact 'failed' sentinel (absent / typo'd → ready)", async () => {
    // The failed branch keys off the literal 'failed'. An absent status, or a
    // typo like 'Failed'/'error', must NOT discard a transcript that actually
    // completed — it lands 'ready' with the text preserved.
    const { client, updates } = makeServiceClient();
    createServiceClientMock.mockReturnValue(client);

    for (const TranscriptionStatus of [undefined, "Failed", "error"]) {
      const res = await POST(
        trForm({
          RecordingSid: "RE-1",
          TranscriptionText: "real transcript",
          TranscriptionStatus,
        }),
      );
      expect(res.status).toBe(200);
    }

    expect(updates).toHaveLength(3);
    for (const upd of updates) {
      expect(upd.patch).toMatchObject({
        transcript: "real transcript",
        transcript_status: "ready",
      });
    }
  });
});

describe("POST /api/phone/webhook/transcription-completed — signature + guards", () => {
  it("returns 403 when the Twilio signature is invalid", async () => {
    validateSignatureMock.mockReturnValue(false);
    const { client, updates } = makeServiceClient();
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      trForm({ RecordingSid: "RE-1", TranscriptionText: "x", TranscriptionStatus: "completed" }),
    );

    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it("returns 400 when RecordingSid is missing (no lookup key)", async () => {
    const { client, updates } = makeServiceClient();
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      trForm({ TranscriptionText: "x", TranscriptionStatus: "completed" }),
    );

    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("returns 200 when RecordingSid matches no voicemail (UPDATE matches zero rows)", async () => {
    const { client, updates } = makeServiceClient();
    createServiceClientMock.mockReturnValue(client);

    const res = await POST(
      trForm({ RecordingSid: "RE-unknown", TranscriptionText: "x", TranscriptionStatus: "completed" }),
    );

    expect(res.status).toBe(200);
    // The UPDATE still runs (matching zero rows); 200 so Twilio stops retrying.
    expect(updates).toHaveLength(1);
  });
});
