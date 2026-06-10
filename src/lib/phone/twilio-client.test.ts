// PRD #304 — Nookleus Phone. Slice 3 (#307) — twilio-client unit tests.
//
// `twilio-client` is the only file in the repo that imports the Twilio
// Node SDK. Other modules use the typed helpers exported here. These tests
// exercise the helpers against an in-memory `TwilioClientLike` fake — the
// real Twilio import is irrelevant to the helper logic and would only
// add network coupling.
//
// AC bullet: "Vitest route tests for the provision and release routes
// (mocked Twilio client)" — the route tests sit one layer up; this file
// covers the helpers the routes call.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  adoptPortedNumber,
  buildBridgeTwiml,
  buildConsentWhisperTwiml,
  buildVoiceTwiml,
  createTwilioClient,
  deleteRecording,
  listAvailableLocalNumbers,
  placeBridgeCall,
  provisionNumber,
  releaseNumber,
  sendSms,
  type TwilioClientLike,
} from "./twilio-client";
import { RECORDING_CONSENT_NOTICE } from "./recording-consent";

function fakeClient(opts: {
  listResult?: unknown[];
  createResult?: { sid: string; phoneNumber: string };
  removeImpl?: () => Promise<void>;
  messageCreateResult?: { sid: string; status: string };
  messageCreateImpl?: (params: unknown) => Promise<unknown>;
  callCreateResult?: { sid: string; status: string };
  callCreateImpl?: (params: unknown) => Promise<unknown>;
  recordingRemoveImpl?: () => Promise<void>;
  // Slice 14 (#318) — incomingPhoneNumbers.list, used by adoptPortedNumber to
  // look up an already-ported number's existing SID (instead of buying one).
  incomingListResult?: Array<{ sid: string; phoneNumber: string }>;
  incomingListSpy?: ReturnType<typeof vi.fn>;
  listSpy?: ReturnType<typeof vi.fn>;
  createSpy?: ReturnType<typeof vi.fn>;
  removeSpy?: ReturnType<typeof vi.fn>;
  messageCreateSpy?: ReturnType<typeof vi.fn>;
  callCreateSpy?: ReturnType<typeof vi.fn>;
  recordingRemoveSpy?: ReturnType<typeof vi.fn>;
}): TwilioClientLike {
  const list = opts.listSpy ?? vi.fn(async () => opts.listResult ?? []);
  const create =
    opts.createSpy ??
    vi.fn(async () => opts.createResult ?? { sid: "PNxxx", phoneNumber: "+15555550100" });
  const incomingList =
    opts.incomingListSpy ?? vi.fn(async () => opts.incomingListResult ?? []);
  const remove = opts.removeSpy ?? vi.fn(opts.removeImpl ?? (async () => undefined));
  const recordingRemove =
    opts.recordingRemoveSpy ??
    vi.fn(opts.recordingRemoveImpl ?? (async () => undefined));
  const messageCreate =
    opts.messageCreateSpy ??
    vi.fn(
      opts.messageCreateImpl ??
        (async () => opts.messageCreateResult ?? { sid: "SMabc", status: "queued" }),
    );
  const callCreate =
    opts.callCreateSpy ??
    vi.fn(
      opts.callCreateImpl ??
        (async () => opts.callCreateResult ?? { sid: "CAabc", status: "queued" }),
    );
  // Twilio SDK shape: `incomingPhoneNumbers` is callable (sid) → resource AND
  // has a `.create` method. We replicate that surface here so the helper
  // can stay byte-identical between fake and real client.
  const incomingPhoneNumbers = Object.assign(
    (_sid: string) => ({ remove }),
    { create, list: incomingList },
  );
  return {
    availablePhoneNumbers: (_country: string) => ({ local: { list } }),
    incomingPhoneNumbers,
    // `recordings` mirrors `incomingPhoneNumbers`'s single-resource callable
    // shape: `client.recordings(sid).remove()` hard-deletes the recording.
    recordings: (_sid: string) => ({ remove: recordingRemove }),
    messages: { create: messageCreate },
    calls: { create: callCreate },
  } as TwilioClientLike;
}

describe("listAvailableLocalNumbers", () => {
  it("returns the available-number list narrowed to the helper's shape", async () => {
    const client = fakeClient({
      listResult: [
        {
          phoneNumber: "+15125551234",
          friendlyName: "(512) 555-1234",
          locality: "Austin",
          region: "TX",
          postalCode: "78701",
          extra_field_we_dont_care_about: "ignored",
        },
        {
          phoneNumber: "+15125555678",
          friendlyName: "(512) 555-5678",
          locality: null,
          region: "TX",
          postalCode: null,
        },
      ],
    });

    const result = await listAvailableLocalNumbers(client, "512");

    expect(result).toEqual([
      {
        phoneNumber: "+15125551234",
        friendlyName: "(512) 555-1234",
        locality: "Austin",
        region: "TX",
      },
      {
        phoneNumber: "+15125555678",
        friendlyName: "(512) 555-5678",
        locality: null,
        region: "TX",
      },
    ]);
  });

  it("passes the area code through to the SDK", async () => {
    const listSpy = vi.fn(async () => []);
    const client = fakeClient({ listSpy });

    await listAvailableLocalNumbers(client, "512");

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ areaCode: "512" }),
    );
  });

  it("rejects non-3-digit area codes (Twilio rejects them too — fail fast in our layer)", async () => {
    const client = fakeClient({});
    await expect(listAvailableLocalNumbers(client, "5125")).rejects.toThrow(
      /area code/i,
    );
    await expect(listAvailableLocalNumbers(client, "")).rejects.toThrow(
      /area code/i,
    );
    await expect(listAvailableLocalNumbers(client, "abc")).rejects.toThrow(
      /area code/i,
    );
  });
});

describe("provisionNumber", () => {
  it("creates an incoming-phone-number and returns the sid + phoneNumber", async () => {
    const createSpy = vi.fn(async () => ({
      sid: "PNabc",
      phoneNumber: "+15125551234",
    }));
    const client = fakeClient({ createSpy });

    const result = await provisionNumber(client, "+15125551234");

    expect(result).toEqual({ sid: "PNabc", phoneNumber: "+15125551234" });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: "+15125551234" }),
    );
  });

  it("rejects non-E.164 phone numbers (defense before hitting Twilio)", async () => {
    const client = fakeClient({});
    await expect(provisionNumber(client, "5125551234")).rejects.toThrow(
      /E\.164/i,
    );
    await expect(provisionNumber(client, "")).rejects.toThrow(/E\.164/i);
  });
});

// Slice 14 (#318) — adopt a number already ported onto the Twilio account.
// Unlike `provisionNumber` (which BUYS a new line via `.create`), a ported
// number already lives on the account; we only need to look up its existing
// SID with `incomingPhoneNumbers.list({phoneNumber})`. No purchase, no charge.
describe("adoptPortedNumber", () => {
  it("looks up an already-ported number by E.164 and returns its existing sid (no purchase)", async () => {
    const incomingListSpy = vi.fn(async () => [
      { sid: "PNported", phoneNumber: "+15125559999" },
    ]);
    const createSpy = vi.fn();
    const client = fakeClient({ incomingListSpy, createSpy });

    const result = await adoptPortedNumber(client, "+15125559999");

    expect(result).toEqual({ sid: "PNported", phoneNumber: "+15125559999" });
    expect(incomingListSpy).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: "+15125559999" }),
    );
    // Adoption must never buy a number — `.create` would incur a charge.
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("rejects non-E.164 phone numbers (defense before hitting Twilio)", async () => {
    const incomingListSpy = vi.fn(async () => []);
    const client = fakeClient({ incomingListSpy });

    await expect(adoptPortedNumber(client, "5125551234")).rejects.toThrow(
      /E\.164/i,
    );
    await expect(adoptPortedNumber(client, "")).rejects.toThrow(/E\.164/i);
    // The guard runs before the lookup — no wasted Twilio round-trip.
    expect(incomingListSpy).not.toHaveBeenCalled();
  });

  it("throws when the number is not on the account yet (port not complete)", async () => {
    const client = fakeClient({ incomingListResult: [] });

    await expect(
      adoptPortedNumber(client, "+15125559999"),
    ).rejects.toThrow(/port not complete/i);
  });
});

describe("releaseNumber", () => {
  it("invokes the Twilio remove() on the named sid", async () => {
    const removeSpy = vi.fn(async () => undefined);
    const client = fakeClient({ removeSpy });

    await releaseNumber(client, "PNabc");

    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it("propagates errors from the SDK (caller can surface them as 5xx)", async () => {
    const client = fakeClient({
      removeImpl: async () => {
        throw new Error("twilio: 404 number not found");
      },
    });

    await expect(releaseNumber(client, "PNzzz")).rejects.toThrow(/404/);
  });

  it("rejects an empty sid (programming-error guard)", async () => {
    const client = fakeClient({});
    await expect(releaseNumber(client, "")).rejects.toThrow(/sid/i);
  });
});

// Slice 10 (#313) — voicemail deletion. Deleting a voicemail hard-deletes the
// recording on Twilio's side (PRD #304 story 54 — Nookleus owns retention).
// `deleteRecording` mirrors `releaseNumber`: a thin wrapper over the SDK's
// `client.recordings(sid).remove()` that the canManage-gated DELETE route
// calls before removing the DB row.
describe("deleteRecording", () => {
  it("invokes the Twilio remove() on the named recording sid", async () => {
    const recordingRemoveSpy = vi.fn(async () => undefined);
    const client = fakeClient({ recordingRemoveSpy });

    await deleteRecording(client, "REabc");

    expect(recordingRemoveSpy).toHaveBeenCalledTimes(1);
  });

  it("propagates non-not-found errors from the SDK (caller surfaces them as 502)", async () => {
    const client = fakeClient({
      recordingRemoveImpl: async () => {
        throw Object.assign(new Error("twilio: 503 service unavailable"), {
          status: 503,
        });
      },
    });

    await expect(deleteRecording(client, "REzzz")).rejects.toThrow(/503/);
  });

  it("treats Twilio's already-deleted recording (404 / code 20404) as success so a DELETE retry can clear the orphaned DB row", async () => {
    // Scenario: a prior DELETE hard-deleted the recording on Twilio, then the
    // DB row-delete failed (500). The admin retries; Twilio now 404s the
    // remove() of the already-gone recording. deleteRecording must swallow it
    // (resolve) so the route falls through to clear the row, instead of
    // 502-looping forever on a recording that no longer exists.
    const recordingRemoveSpy = vi.fn(async () => {
      throw Object.assign(new Error("The requested resource was not found"), {
        status: 404,
        code: 20404,
      });
    });
    const client = fakeClient({ recordingRemoveSpy });

    await expect(deleteRecording(client, "REgone")).resolves.toBeUndefined();
    expect(recordingRemoveSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty sid (programming-error guard)", async () => {
    const client = fakeClient({});
    await expect(deleteRecording(client, "")).rejects.toThrow(/sid/i);
  });
});

describe("sendSms", () => {
  it("dispatches a Twilio message and returns the SID + status", async () => {
    const messageCreateSpy = vi.fn(async () => ({
      sid: "SMxyz",
      status: "queued",
    }));
    const client = fakeClient({ messageCreateSpy });

    const result = await sendSms(client, {
      from: "+15125550000",
      to: "+15551234567",
      body: "hello from Nookleus",
      statusCallback: "https://example.com/cb",
    });

    expect(messageCreateSpy).toHaveBeenCalledTimes(1);
    expect(messageCreateSpy).toHaveBeenCalledWith({
      from: "+15125550000",
      to: "+15551234567",
      body: "hello from Nookleus",
      statusCallback: "https://example.com/cb",
    });
    expect(result).toEqual({ sid: "SMxyz", status: "queued" });
  });

  it("omits statusCallback from the SDK call when not provided", async () => {
    const messageCreateSpy = vi.fn(async () => ({ sid: "SMa", status: "queued" }));
    const client = fakeClient({ messageCreateSpy });

    await sendSms(client, {
      from: "+15125550000",
      to: "+15551234567",
      body: "hi",
    });

    const calls = messageCreateSpy.mock.calls as Array<unknown[]>;
    const payload = calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("statusCallback");
  });

  it("rejects when from is not E.164", async () => {
    const client = fakeClient({});
    await expect(
      sendSms(client, { from: "5125550000", to: "+15551234567", body: "hi" }),
    ).rejects.toThrow(/from.*E\.164/);
  });

  it("rejects when to is not E.164", async () => {
    const client = fakeClient({});
    await expect(
      sendSms(client, { from: "+15125550000", to: "5551234567", body: "hi" }),
    ).rejects.toThrow(/to.*E\.164/);
  });

  it("rejects when body is empty", async () => {
    const client = fakeClient({});
    await expect(
      sendSms(client, { from: "+15125550000", to: "+15551234567", body: "" }),
    ).rejects.toThrow(/body/i);
  });

  it("propagates errors from the SDK (caller can surface as 5xx)", async () => {
    const client = fakeClient({
      messageCreateImpl: async () => {
        throw new Error("twilio: 21610 message blocked");
      },
    });
    await expect(
      sendSms(client, { from: "+15125550000", to: "+15551234567", body: "hi" }),
    ).rejects.toThrow(/21610/);
  });

  // Slice 6 (#310) — MMS attachments.
  it("includes the mediaUrl array in the SDK call when given", async () => {
    const messageCreateSpy = vi.fn(async () => ({ sid: "SMmms", status: "queued" }));
    const client = fakeClient({ messageCreateSpy });
    await sendSms(client, {
      from: "+15125550000",
      to: "+15551234567",
      body: "see attached",
      mediaUrl: [
        "https://signed/phone-attachments/org-1/a.jpg",
        "https://signed/phone-attachments/org-1/b.png",
      ],
    });
    const payload = (messageCreateSpy.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      mediaUrl: [
        "https://signed/phone-attachments/org-1/a.jpg",
        "https://signed/phone-attachments/org-1/b.png",
      ],
    });
  });

  it("omits mediaUrl from the SDK call when none is provided", async () => {
    const messageCreateSpy = vi.fn(async () => ({ sid: "SMa", status: "queued" }));
    const client = fakeClient({ messageCreateSpy });
    await sendSms(client, {
      from: "+15125550000",
      to: "+15551234567",
      body: "hi",
    });
    const payload = (messageCreateSpy.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("mediaUrl");
  });

  it("accepts an empty body when mediaUrl is non-empty (image-only MMS)", async () => {
    const messageCreateSpy = vi.fn(async () => ({ sid: "SMmms", status: "queued" }));
    const client = fakeClient({ messageCreateSpy });
    const result = await sendSms(client, {
      from: "+15125550000",
      to: "+15551234567",
      body: "",
      mediaUrl: ["https://signed/phone-attachments/org-1/photo.jpg"],
    });
    expect(result).toEqual({ sid: "SMmms", status: "queued" });
    expect(messageCreateSpy).toHaveBeenCalledOnce();
  });

  it("still rejects when both body AND mediaUrl are empty", async () => {
    const client = fakeClient({});
    await expect(
      sendSms(client, {
        from: "+15125550000",
        to: "+15551234567",
        body: "",
        mediaUrl: [],
      }),
    ).rejects.toThrow(/body|media/i);
  });

  // Slice 1 (#305) — A2P 10DLC. US carriers only deliver outbound business
  // SMS that is associated with the registered campaign's Messaging Service.
  // When a messagingServiceSid is supplied it rides along in the SDK call so
  // Twilio attaches the message to the approved campaign.
  it("includes the messagingServiceSid in the SDK call when provided (#305 A2P campaign association)", async () => {
    const messageCreateSpy = vi.fn(async () => ({ sid: "SMa2p", status: "queued" }));
    const client = fakeClient({ messageCreateSpy });
    await sendSms(client, {
      from: "+15125550000",
      to: "+15551234567",
      body: "your quote is ready",
      messagingServiceSid: "MG0123456789abcdef0123456789abcdef",
    });
    const payload = (messageCreateSpy.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      messagingServiceSid: "MG0123456789abcdef0123456789abcdef",
    });
  });

  // The A2P dual form: a messagingServiceSid does NOT replace `from`. Nookleus
  // selects a specific outbound number (Personal-if-any-else-Shared), so the
  // send must keep that `from` (Twilio requires it be in the Service's sender
  // pool) AND carry the Service SID for the campaign association.
  it("keeps `from` alongside the messagingServiceSid (deterministic sender + campaign association)", async () => {
    const messageCreateSpy = vi.fn(async () => ({ sid: "SMa2p", status: "queued" }));
    const client = fakeClient({ messageCreateSpy });
    await sendSms(client, {
      from: "+15125550000",
      to: "+15551234567",
      body: "your quote is ready",
      messagingServiceSid: "MG0123456789abcdef0123456789abcdef",
    });
    const payload = (messageCreateSpy.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      from: "+15125550000",
      messagingServiceSid: "MG0123456789abcdef0123456789abcdef",
    });
  });

  // Mirrors the statusCallback / mediaUrl omit tests above: a falsy
  // messagingServiceSid must NOT reach the SDK as a present-but-empty key
  // (an explicit blank Service SID is not the same as omitting it).
  it("omits messagingServiceSid from the SDK call when none is provided", async () => {
    const messageCreateSpy = vi.fn(async () => ({ sid: "SMa", status: "queued" }));
    const client = fakeClient({ messageCreateSpy });
    await sendSms(client, {
      from: "+15125550000",
      to: "+15551234567",
      body: "hi",
    });
    const payload = (messageCreateSpy.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("messagingServiceSid");
  });
});

// ---------------------------------------------------------------------------
// Slice 15 (#368) — Phone demo / dev mode. The factory grows a single guard
// at the top: when `NOOKLEUS_PHONE_DEMO_MODE === 'true'` it returns the
// in-process fake provider instead of constructing the real Twilio SDK, so
// the rest of the Phone feature can be exercised end-to-end with no carrier
// and no Twilio credentials. The fail-safe is non-negotiable: in production
// the flag throws rather than returning a fake — a fake provider must
// never silently swallow a real customer's SMS.
// ---------------------------------------------------------------------------

describe("createTwilioClient — Phone demo mode guard (#368)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a TwilioClientLike fake when NOOKLEUS_PHONE_DEMO_MODE is 'true', without TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN", async () => {
    // No Twilio credentials set: demo mode skips the credential check
    // entirely (the fake never touches the SDK).
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("NOOKLEUS_PHONE_DEMO_MODE", "true");
    vi.stubEnv("NODE_ENV", "development");

    const client = createTwilioClient();

    // Smoke-check the shape: a fake provider that satisfies the
    // interface, exercised through the same helpers the routes use.
    const sendResult = await sendSms(client, {
      from: "+15125550000",
      to: "+15551234567",
      body: "hello demo",
    });
    expect(sendResult.sid).toMatch(/^SM/);
    expect(sendResult.status).toBe("queued");

    const provisioned = await provisionNumber(client, "+15125550100");
    expect(provisioned.sid).toMatch(/^PN/);
    expect(provisioned.phoneNumber).toBe("+15125550100");

    await expect(releaseNumber(client, provisioned.sid)).resolves.toBeUndefined();
  });

  it("throws when NOOKLEUS_PHONE_DEMO_MODE is 'true' under NODE_ENV=production (production fail-safe)", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC-real");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "auth-real");
    vi.stubEnv("NOOKLEUS_PHONE_DEMO_MODE", "true");
    vi.stubEnv("NODE_ENV", "production");

    expect(() => createTwilioClient()).toThrow(/demo|production/i);
  });

  it("still requires TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN when demo mode is OFF (existing behavior unchanged)", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("NOOKLEUS_PHONE_DEMO_MODE", "");
    vi.stubEnv("NODE_ENV", "development");

    expect(() => createTwilioClient()).toThrow(/TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN/);
  });
});

// ---------------------------------------------------------------------------
// Slice 8 (#312) — buildVoiceTwiml. Turns a decideShared() decision into the
// TwiML Twilio executes for an inbound voice call. Pure (uses the Twilio
// SDK's twiml.VoiceResponse builder for correct XML escaping; no network).
// twilio-client is the only file allowed to import twilio, so the builder
// lives here alongside the other Twilio-boundary helpers.
// ---------------------------------------------------------------------------
describe("buildVoiceTwiml — ring-all", () => {
  it("dials every cell as a <Number> child of one <Dial> (parallel ring)", () => {
    const xml = buildVoiceTwiml(
      { kind: "ring-all", cells: ["+15125550001", "+15125550002"] },
      { callerId: "+15125550000" },
    );
    expect(xml).toContain("<Dial");
    expect(xml).toContain("<Number>+15125550001</Number>");
    expect(xml).toContain("<Number>+15125550002</Number>");
  });
});

describe("buildVoiceTwiml — forward", () => {
  it("dials the single forward-target cell", () => {
    const xml = buildVoiceTwiml(
      { kind: "forward", cell: "+15125550009" },
      { callerId: "+15125550000" },
    );
    expect(xml).toContain("<Dial");
    expect(xml).toContain("<Number>+15125550009</Number>");
  });
});

describe("buildVoiceTwiml — round-robin", () => {
  it("dials the single member the cursor selected (nextCursor is the caller's concern)", () => {
    const xml = buildVoiceTwiml(
      { kind: "round-robin", cell: "+15125550007", nextCursor: 3 },
      { callerId: "+15125550000" },
    );
    expect(xml).toContain("<Dial");
    expect(xml).toContain("<Number>+15125550007</Number>");
    // The cursor is rotation bookkeeping persisted by the webhook — it must
    // never leak into the TwiML Twilio executes.
    expect(xml).not.toContain("nextCursor");
    expect(xml).not.toContain("3");
  });
});

describe("buildVoiceTwiml — voicemail", () => {
  it("speaks a default greeting then records the caller", () => {
    const xml = buildVoiceTwiml({ kind: "voicemail" });
    expect(xml).toContain("<Say");
    expect(xml).toContain("<Record");
    // No dial leg — the call goes straight to the recorder.
    expect(xml).not.toContain("<Dial");
  });
});

// ---------------------------------------------------------------------------
// Slice 10 (#314) — outbound bridge call. `buildBridgeTwiml` is the inline
// TwiML Twilio executes when the Crew Lead answers their cell: it dials the
// customer with the Nookleus number presented as caller ID, so the customer
// NEVER sees the Crew Lead's real cell. This is the caller-ID-spoofing safety
// property the whole slice rests on. Pure (Twilio SDK's twiml.VoiceResponse
// for correct XML escaping; no network).
// ---------------------------------------------------------------------------
describe("buildBridgeTwiml — outbound bridge (#314)", () => {
  it("dials the customer as a <Number> with the Nookleus number as caller ID", () => {
    const xml = buildBridgeTwiml({
      customerE164: "+15551234567",
      callerId: "+15125550000",
    });
    expect(xml).toContain("<Dial");
    // The customer's caller ID is the Nookleus number — not the crew lead's cell.
    expect(xml).toContain('callerId="+15125550000"');
    expect(xml).toContain("<Number>+15551234567</Number>");
  });
});

// ---------------------------------------------------------------------------
// Slice 11 (#315) — call recording + consent on the outbound bridge. When
// recording is enabled, the Crew Lead (the answered originating leg) hears the
// consent notice before the dial, the bridged conversation is recorded
// dual-channel and posts to the recording-completed webhook, and the customer
// (the answering leg) hears the same notice via the <Number> whisper URL.
// Disabled → byte-for-byte the slice-10 bridge dial.
// ---------------------------------------------------------------------------
describe("buildBridgeTwiml — call recording + consent (#315)", () => {
  it("speaks consent, records the bridge, and whispers consent to the customer when recording is enabled", () => {
    const xml = buildBridgeTwiml({
      customerE164: "+15551234567",
      callerId: "+15125550000",
      recordCall: true,
      callRecordingStatusCallback:
        "https://app.example.com/api/phone/webhook/recording-completed",
      consentWhisperUrl:
        "https://app.example.com/api/phone/webhook/recording-whisper",
    });
    // The Crew Lead (originating leg) hears the notice before the dial.
    expect(xml).toContain("<Say");
    expect(xml).toContain(RECORDING_CONSENT_NOTICE);
    // The bridged conversation is recorded dual-channel with the callback.
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain(
      'recordingStatusCallback="https://app.example.com/api/phone/webhook/recording-completed"',
    );
    // The customer (answering leg) hears the SAME notice via the whisper URL.
    expect(xml).toContain(
      'url="https://app.example.com/api/phone/webhook/recording-whisper"',
    );
    expect(xml).toContain("+15551234567");
  });

  it("emits no consent notice and no recording when recording is disabled", () => {
    const xml = buildBridgeTwiml({
      customerE164: "+15551234567",
      callerId: "+15125550000",
      recordCall: false,
    });
    expect(xml).not.toContain("<Say");
    expect(xml).not.toContain("record=");
    expect(xml).not.toContain(RECORDING_CONSENT_NOTICE);
    expect(xml).toContain("<Number>+15551234567</Number>");
  });
});

// ---------------------------------------------------------------------------
// Slice 11 (#315) — buildConsentWhisperTwiml is the static TwiML the
// recording-whisper endpoint serves: it plays the canonical consent notice to
// the answering party of a recorded call (via each <Number url=...> whisper),
// so both parties hear it. Sourced from the recording-consent module so it can
// never drift from the spoken-to-the-caller notice.
// ---------------------------------------------------------------------------
describe("buildConsentWhisperTwiml — answering-party consent whisper (#315)", () => {
  it("plays only the canonical consent notice", () => {
    const xml = buildConsentWhisperTwiml();
    expect(xml).toContain("<Say");
    expect(xml).toContain(RECORDING_CONSENT_NOTICE);
    // A whisper plays to the callee and returns — it never dials anyone.
    expect(xml).not.toContain("<Dial");
  });
});

// ---------------------------------------------------------------------------
// Slice 10 (#314) — placeBridgeCall. Rings the Crew Lead's cell (`to`) from
// the Nookleus number (`from`), executing the inline bridge `twiml` on answer.
// Returns the outer-leg CallSid + initial status; the route stores that SID so
// the voice-status webhook can advance the call through its state machine.
// Mirrors sendSms: E.164 guards before the SDK, errors propagate to the caller.
// ---------------------------------------------------------------------------
describe("placeBridgeCall", () => {
  it("dispatches a Twilio call (cell FROM the Nookleus number, inline bridge twiml) and returns SID + status", async () => {
    const callCreateSpy = vi.fn(async () => ({ sid: "CAxyz", status: "queued" }));
    const client = fakeClient({ callCreateSpy });

    const result = await placeBridgeCall(client, {
      from: "+15125550000",
      to: "+15129990000",
      twiml: '<Response><Dial callerId="+15125550000"><Number>+15551234567</Number></Dial></Response>',
      statusCallback: "https://example.com/voice-status",
    });

    expect(callCreateSpy).toHaveBeenCalledTimes(1);
    const payload = (callCreateSpy.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      from: "+15125550000",
      to: "+15129990000",
      twiml:
        '<Response><Dial callerId="+15125550000"><Number>+15551234567</Number></Dial></Response>',
      statusCallback: "https://example.com/voice-status",
    });
    expect(result).toEqual({ sid: "CAxyz", status: "queued" });
  });

  it("requests the full event list so ringing/answered transitions reach the webhook (not just 'completed')", async () => {
    // Twilio's default statusCallbackEvent is ['completed'] only. Without the
    // intermediate events the in-flight thread row would jump straight from
    // queued to completed — never showing ringing / in-progress. Pin that
    // placeBridgeCall opts into the whole lifecycle whenever a callback is set.
    const callCreateSpy = vi.fn(async () => ({ sid: "CAa", status: "queued" }));
    const client = fakeClient({ callCreateSpy });

    await placeBridgeCall(client, {
      from: "+15125550000",
      to: "+15129990000",
      twiml: "<Response><Dial><Number>+15551234567</Number></Dial></Response>",
      statusCallback: "https://example.com/voice-status",
    });

    const payload = (callCreateSpy.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    const events = payload.statusCallbackEvent as string[];
    expect(events).toEqual(
      expect.arrayContaining(["initiated", "ringing", "answered", "completed"]),
    );
  });

  it("omits statusCallback (and the event list) when no callback URL is provided", async () => {
    const callCreateSpy = vi.fn(async () => ({ sid: "CAa", status: "queued" }));
    const client = fakeClient({ callCreateSpy });

    await placeBridgeCall(client, {
      from: "+15125550000",
      to: "+15129990000",
      twiml: "<Response><Dial><Number>+15551234567</Number></Dial></Response>",
    });

    const payload = (callCreateSpy.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("statusCallback");
    expect(payload).not.toHaveProperty("statusCallbackEvent");
  });

  it("rejects when from is not E.164 (caller-ID safety — never dial from a non-owned number shape)", async () => {
    const client = fakeClient({});
    await expect(
      placeBridgeCall(client, {
        from: "5125550000",
        to: "+15129990000",
        twiml: "<Response/>",
      }),
    ).rejects.toThrow(/from.*E\.164/);
  });

  it("rejects when to is not E.164", async () => {
    const client = fakeClient({});
    await expect(
      placeBridgeCall(client, {
        from: "+15125550000",
        to: "5129990000",
        twiml: "<Response/>",
      }),
    ).rejects.toThrow(/to.*E\.164/);
  });

  it("rejects when twiml is empty (a bridge call with no dial leg is a programming error)", async () => {
    const client = fakeClient({});
    await expect(
      placeBridgeCall(client, {
        from: "+15125550000",
        to: "+15129990000",
        twiml: "",
      }),
    ).rejects.toThrow(/twiml/i);
  });

  it("propagates errors from the SDK (caller surfaces as 5xx)", async () => {
    const client = fakeClient({
      callCreateImpl: async () => {
        throw new Error("twilio: 21215 geo-permission not enabled");
      },
    });
    await expect(
      placeBridgeCall(client, {
        from: "+15125550000",
        to: "+15129990000",
        twiml: "<Response><Dial><Number>+15551234567</Number></Dial></Response>",
      }),
    ).rejects.toThrow(/21215/);
  });
});

// ---------------------------------------------------------------------------
// Slice 9 (#313) — Voicemail + auto-transcription. The voicemail branch of
// buildVoiceTwiml grows the <Record> callback wiring: Twilio posts the
// finished recording to the voicemail-completed webhook (recordingStatusCallback)
// and the auto-transcription to the transcription-completed webhook
// (transcribeCallback). The two callback URLs are injected through
// VoiceTwimlOptions so the route supplies them from env (mirroring
// PHONE_STATUS_CALLBACK_URL for SMS) and the builder stays pure.
// ---------------------------------------------------------------------------
describe("buildVoiceTwiml — voicemail recording callbacks (#313)", () => {
  it("wires <Record recordingStatusCallback> to the voicemail-completed URL", () => {
    const xml = buildVoiceTwiml(
      { kind: "voicemail" },
      {
        recordingStatusCallback:
          "https://app.example.com/api/phone/webhook/voicemail-completed",
      },
    );
    expect(xml).toContain(
      'recordingStatusCallback="https://app.example.com/api/phone/webhook/voicemail-completed"',
    );
  });

  it("enables transcription and wires <Record transcribeCallback> to the transcription-completed URL", () => {
    const xml = buildVoiceTwiml(
      { kind: "voicemail" },
      {
        transcribeCallback:
          "https://app.example.com/api/phone/webhook/transcription-completed",
      },
    );
    expect(xml).toContain('transcribe="true"');
    expect(xml).toContain(
      'transcribeCallback="https://app.example.com/api/phone/webhook/transcription-completed"',
    );
  });

  it("plays a beep and caps the recording length (voicemail UX defaults, no options needed)", () => {
    const xml = buildVoiceTwiml({ kind: "voicemail" });
    expect(xml).toContain('playBeep="true"');
    expect(xml).toContain('maxLength="120"');
  });
});

// ---------------------------------------------------------------------------
// Slice 11 (#315) — call recording + consent on the inbound dial branches.
// When recording is enabled, every answered inbound call (ring-all / forward /
// round-robin) speaks the legally-required consent notice to the caller, then
// records the bridged conversation (dual channel) and posts the finished
// recording to the recording-completed webhook. The answering team member
// hears the same notice via the per-leg whisper URL on each <Number>. When
// recording is NOT enabled the TwiML is byte-for-byte the slice-8 dial (the
// existing ring-all/forward/round-robin tests above are the regression guard).
// ---------------------------------------------------------------------------
describe("buildVoiceTwiml — call recording + consent (#315)", () => {
  it("speaks the consent notice and records the dial when recording is enabled", () => {
    const xml = buildVoiceTwiml(
      { kind: "forward", cell: "+15125550009" },
      {
        callerId: "+15125550000",
        recordCall: true,
        callRecordingStatusCallback:
          "https://app.example.com/api/phone/webhook/recording-completed",
        consentWhisperUrl:
          "https://app.example.com/api/phone/webhook/recording-whisper",
      },
    );
    // The inbound caller (originating leg) hears the consent notice before the dial.
    expect(xml).toContain("<Say");
    expect(xml).toContain(RECORDING_CONSENT_NOTICE);
    // The bridged conversation is recorded dual-channel with the recording-completed callback.
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain(
      'recordingStatusCallback="https://app.example.com/api/phone/webhook/recording-completed"',
    );
    // The answering team member hears the SAME notice via the per-leg whisper URL.
    expect(xml).toContain(
      'url="https://app.example.com/api/phone/webhook/recording-whisper"',
    );
    expect(xml).toContain("+15125550009");
  });

  it("emits no consent notice and no recording when recording is disabled", () => {
    const xml = buildVoiceTwiml(
      { kind: "forward", cell: "+15125550009" },
      { callerId: "+15125550000", recordCall: false },
    );
    expect(xml).not.toContain("<Say");
    expect(xml).not.toContain("record=");
    expect(xml).not.toContain(RECORDING_CONSENT_NOTICE);
    // Identical to the slice-8 bare dial.
    expect(xml).toContain("<Number>+15125550009</Number>");
  });

  it("whispers the consent notice to every cell on a ring-all (consent said once to the caller)", () => {
    const xml = buildVoiceTwiml(
      { kind: "ring-all", cells: ["+15125550001", "+15125550002"] },
      {
        callerId: "+15125550000",
        recordCall: true,
        consentWhisperUrl:
          "https://app.example.com/api/phone/webhook/recording-whisper",
      },
    );
    // The caller hears the notice exactly once before the parallel ring.
    expect(xml.match(/<Say/g)).toHaveLength(1);
    // Every reachable cell carries the whisper URL.
    expect(
      xml.match(/url="https:\/\/app\.example\.com\/api\/phone\/webhook\/recording-whisper"/g),
    ).toHaveLength(2);
  });
});
