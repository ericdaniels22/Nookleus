// PRD #304 — Nookleus Phone. The single Twilio-SDK entry point for the
// whole repo. Every other module imports the typed helpers exported here,
// never `twilio` from the Node SDK directly. AC bullet:
//
//   "twilio-client module is the only file in the repo that imports
//    twilio"
//
// Slice 3 (#307) uses three Twilio surfaces:
//   - availablePhoneNumbers('US').local.list({ areaCode })   — number picker
//   - incomingPhoneNumbers.create({ phoneNumber })           — provision
//   - incomingPhoneNumbers(sid).remove()                      — release
//
// The helpers below sit on top of a small `TwilioClientLike` shape that
// covers exactly that surface. The real Twilio client (constructed by
// `createTwilioClient`) is asserted into that shape; tests inject a fake
// of the same shape. The helpers themselves never import twilio, so they
// stay testable without network and without the Node SDK eval-time setup.

import twilio, { validateRequest } from "twilio";
import { createFakeTwilioClient } from "./fake-twilio-client";
import type { DecideSharedResult } from "./route-shared-call";

// A narrowed slice of an item returned by `availablePhoneNumbers.list` —
// the four fields the UI's "pick a number" step actually shows. Twilio
// returns many more, but the wider list is irrelevant downstream and
// pinning the narrow shape keeps the type contract stable.
export interface AvailableLocalNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
}

export interface ProvisionedNumber {
  sid: string;
  phoneNumber: string;
}

// The Twilio surface our helpers depend on, expressed structurally so a
// fake can replicate it without inheriting from the SDK class. The SDK's
// `incomingPhoneNumbers` is the unusual dual shape: callable as
// `client.incomingPhoneNumbers(sid)` to address a single resource AND has
// a `.create(opts)` method to provision a new one. We model both.
export interface TwilioClientLike {
  availablePhoneNumbers(country: string): {
    local: {
      list(opts: { areaCode: string; limit?: number }): Promise<unknown[]>;
    };
  };
  incomingPhoneNumbers: ((sid: string) => {
    remove(): Promise<unknown>;
  }) & {
    create(opts: { phoneNumber: string }): Promise<{
      sid: string;
      phoneNumber: string;
    }>;
  };
  // Slice 10 (#313) — voicemail deletion. The SDK's `recordings` is the same
  // callable-single-resource shape: `client.recordings(sid).remove()` issues
  // Twilio's hard-delete of the recording media.
  recordings(sid: string): {
    remove(): Promise<unknown>;
  };
  messages: {
    create(opts: {
      from: string;
      to: string;
      body: string;
      statusCallback?: string;
      mediaUrl?: string[];
      // Slice 1 (#305) — A2P 10DLC. Associates the message with the
      // registered campaign's Messaging Service so US carriers deliver it.
      messagingServiceSid?: string;
    }): Promise<{ sid: string; status: string }>;
  };
  // Slice 10 (#314) — outbound bridge calling. We use the inline-`twiml`
  // form (TwiML executed on answer) rather than a hosted `url`, so the
  // customer number never transits a webhook URL.
  calls: {
    create(opts: {
      from: string;
      to: string;
      twiml: string;
      statusCallback?: string;
      statusCallbackEvent?: string[];
      statusCallbackMethod?: string;
    }): Promise<{ sid: string; status: string }>;
  };
}

// US 3-digit area codes only. Twilio enforces the same; failing fast here
// keeps the network round-trip out of unit tests and makes 400s in the UI
// produce a clearer error than Twilio's verbose validation reply.
const AREA_CODE_RE = /^\d{3}$/;

// E.164 with leading + and 10–15 digits. Twilio enforces tighter US-specific
// shape on `incomingPhoneNumbers.create`, but the helper layer only needs
// to reject obviously wrong inputs (raw 10-digit US, empty, etc.).
const E164_RE = /^\+[1-9]\d{6,14}$/;

/**
 * Search Twilio's local-numbers inventory for the US area code. Returns a
 * narrowed shape — see `AvailableLocalNumber`. The SDK supports a `limit`
 * (default 20); slice 3's UI shows a small list, so this is wired to
 * Twilio's default and not exposed to callers.
 */
export async function listAvailableLocalNumbers(
  client: TwilioClientLike,
  areaCode: string,
): Promise<AvailableLocalNumber[]> {
  if (!AREA_CODE_RE.test(areaCode)) {
    throw new Error(`twilio-client: invalid area code "${areaCode}" (must be 3 digits)`);
  }
  const rows = await client.availablePhoneNumbers("US").local.list({ areaCode });
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      phoneNumber: String(row.phoneNumber ?? ""),
      friendlyName: String(row.friendlyName ?? ""),
      locality: (row.locality ?? null) as string | null,
      region: (row.region ?? null) as string | null,
    };
  });
}

/**
 * Provision an inbound number from Twilio. Returns the Twilio SID we then
 * store in `phone_numbers.twilio_sid` (the only handle we keep — every
 * subsequent operation on the number is by SID).
 */
export async function provisionNumber(
  client: TwilioClientLike,
  phoneNumber: string,
): Promise<ProvisionedNumber> {
  if (!E164_RE.test(phoneNumber)) {
    throw new Error(
      `twilio-client: invalid phoneNumber "${phoneNumber}" (must be E.164, e.g. +15125551234)`,
    );
  }
  const created = await client.incomingPhoneNumbers.create({ phoneNumber });
  return { sid: created.sid, phoneNumber: created.phoneNumber };
}

/**
 * Release a number on Twilio's side. Caller is expected to mark the row's
 * `released_at` in `phone_numbers` separately — this helper does Twilio
 * only, so the call site can decide ordering (we delete on Twilio first
 * so a billing-relevant remove cannot be lost behind a DB-write failure).
 */
export async function releaseNumber(
  client: TwilioClientLike,
  sid: string,
): Promise<void> {
  if (!sid) {
    throw new Error("twilio-client: releaseNumber called with empty sid");
  }
  await client.incomingPhoneNumbers(sid).remove();
}

/**
 * Hard-delete a recording on Twilio's side. Slice 10 (#313): deleting a
 * voicemail removes the Twilio recording media (PRD #304 story 54 — Nookleus
 * owns retention, and the playable copy lives in our own Storage bucket). Like
 * `releaseNumber`, this does Twilio only; the call site decides ordering — we
 * delete on Twilio first so a billing/retention-relevant remove cannot be lost
 * behind a DB-write failure.
 */
export async function deleteRecording(
  client: TwilioClientLike,
  sid: string,
): Promise<void> {
  if (!sid) {
    throw new Error("twilio-client: deleteRecording called with empty sid");
  }
  try {
    await client.recordings(sid).remove();
  } catch (err) {
    // Idempotent: Twilio 404s a remove() of an already-deleted recording
    // (HTTP 404 / error code 20404). Treat that as success so a DELETE retry
    // — after a prior Twilio-success + DB-write failure — can fall through to
    // clear the orphaned row, instead of 502-looping on a recording that no
    // longer exists. Re-throw any other (transient / auth) error so the route
    // still surfaces a 502 and leaves the DB row untouched.
    if (isRecordingAlreadyGone(err)) return;
    throw err;
  }
}

// Twilio's RestException carries the HTTP `status` and a numeric Twilio
// `code`; an already-deleted recording surfaces as 404 / 20404.
function isRecordingAlreadyGone(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { status?: unknown; code?: unknown };
  return e.status === 404 || e.code === 20404;
}

export interface SendSmsParams {
  from: string;
  to: string;
  body: string;
  statusCallback?: string;
  // Slice 6 (#310) — MMS attachments. Each entry is a publicly-fetchable
  // URL Twilio downloads from; pass an empty/undefined array for plain SMS.
  // An MMS may carry an empty body provided at least one mediaUrl is set.
  mediaUrl?: string[];
  // Slice 1 (#305) — A2P 10DLC. The SID of the Messaging Service bound to the
  // approved Customer Care campaign. When set, the message is sent through the
  // Service (alongside `from`, which must be in the Service's sender pool) so
  // US carriers associate it with the campaign and deliver it. Omitted until
  // the campaign clears carrier review — see TWILIO_MESSAGING_SERVICE_SID.
  messagingServiceSid?: string;
}

export interface SendSmsResult {
  sid: string;
  status: string;
}

/**
 * Send an outbound SMS through Twilio. Returns the Twilio message SID and
 * initial status (typically `'queued'`). The status callback URL — when
 * supplied — tells Twilio to POST delivery updates to our status-callback
 * webhook so we can flip `phone_messages.status` to delivered / failed.
 *
 * Slice 5 (#309) is the first caller; slice 6 (MMS) extends with
 * `mediaUrl` once the schema lands the attachment write path.
 */
export async function sendSms(
  client: TwilioClientLike,
  params: SendSmsParams,
): Promise<SendSmsResult> {
  if (!E164_RE.test(params.from)) {
    throw new Error(
      `twilio-client: sendSms from "${params.from}" must be E.164 (e.g. +15125551234)`,
    );
  }
  if (!E164_RE.test(params.to)) {
    throw new Error(
      `twilio-client: sendSms to "${params.to}" must be E.164 (e.g. +15125551234)`,
    );
  }
  const hasMedia = (params.mediaUrl?.length ?? 0) > 0;
  if (params.body.length === 0 && !hasMedia) {
    throw new Error(
      "twilio-client: sendSms requires a non-empty body OR at least one mediaUrl",
    );
  }
  const payload: {
    from: string;
    to: string;
    body: string;
    statusCallback?: string;
    mediaUrl?: string[];
    messagingServiceSid?: string;
  } = {
    from: params.from,
    to: params.to,
    body: params.body,
  };
  if (params.statusCallback) payload.statusCallback = params.statusCallback;
  if (hasMedia) payload.mediaUrl = params.mediaUrl;
  // Slice 1 (#305) — A2P campaign association, when configured.
  if (params.messagingServiceSid) {
    payload.messagingServiceSid = params.messagingServiceSid;
  }
  const created = await client.messages.create(payload);
  return { sid: created.sid, status: created.status };
}

/**
 * Build a Twilio client from env vars. Routes call this once per request;
 * the underlying Twilio client is stateless and cheap to construct. We
 * intentionally do NOT cache it — env vars are read once at server start
 * and a cached client survives every deploy regardless.
 *
 * Tests should NOT call this — they inject a `TwilioClientLike` fake into
 * the helpers above. This factory is the only function in the module that
 * touches the Twilio SDK at runtime; everything else is pure shape.
 */
export function createTwilioClient(): TwilioClientLike {
  // Slice 15 (#368) — Phone demo / dev mode. When the server-side
  // NOOKLEUS_PHONE_DEMO_MODE flag is set, the entire Phone feature runs
  // against an in-process fake provider instead of the real Twilio SDK,
  // so demos and slice 6–13 development can proceed while #305 (A2P
  // 10DLC carrier registration) sits in carrier review. The
  // production-side throw is the safety property — a fake provider
  // must never silently swallow a real customer's SMS.
  if (process.env.NOOKLEUS_PHONE_DEMO_MODE === "true") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "twilio-client: NOOKLEUS_PHONE_DEMO_MODE must NOT be set in production " +
          "(the fake provider would silently swallow real outbound SMS)",
      );
    }
    return createFakeTwilioClient();
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error(
      "twilio-client: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set",
    );
  }
  return twilio(accountSid, authToken) as unknown as TwilioClientLike;
}

/**
 * Verify an inbound webhook came from Twilio. Twilio signs the request
 * with the account auth token; we recompute the signature over the
 * (url, params) pair and compare. Returns true on match. The webhook
 * route should 403 on false.
 *
 * Reads `TWILIO_AUTH_TOKEN` from the environment — tests should not
 * call this; instead they verify the webhook's wiring with the auth
 * token mocked.
 */
export function validateTwilioSignature(
  url: string,
  twilioSignatureHeader: string | null,
  params: Record<string, string>,
): boolean {
  if (!twilioSignatureHeader) return false;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    throw new Error("twilio-client: TWILIO_AUTH_TOKEN must be set");
  }
  return validateRequest(authToken, twilioSignatureHeader, url, params);
}

// ---------------------------------------------------------------------------
// Slice 8 (#312) — inbound voice TwiML. `buildVoiceTwiml` turns a
// `decideShared()` decision (the pure routing module's output) into the XML
// Twilio executes when an inbound call hits a Shared number. twilio-client is
// the only file allowed to import twilio, so the TwiML builder lives here —
// using the SDK's `twiml.VoiceResponse` for correct XML escaping rather than
// hand-concatenating strings.
// ---------------------------------------------------------------------------
export interface VoiceTwimlOptions {
  // The Nookleus number to present as the caller ID on the outbound legs, so
  // the team member's phone shows the business number (not the outside
  // caller) and a call-back rings the Nookleus number.
  callerId?: string;
  // Slice 9 (#313) — voicemail recording callbacks. When the decision is
  // voicemail, the <Record> verb posts the finished recording here (Twilio's
  // RecordingSid / RecordingUrl / RecordingDuration + the CallSid). The route
  // supplies the voicemail-completed webhook URL from env; omitted in the
  // dial branches.
  recordingStatusCallback?: string;
  // Slice 9 (#313) — auto-transcription callback. When set, the <Record>
  // verb requests Twilio's auto-transcription (transcribe="true") and posts
  // the result here (Twilio's TranscriptionText / TranscriptionStatus +
  // RecordingSid). The route supplies the transcription-completed webhook URL
  // from env; transcription is off when this is omitted.
  transcribeCallback?: string;
}

// Spoken when an inbound call falls through to voicemail and no custom
// greeting is configured for the number.
const DEFAULT_VOICEMAIL_GREETING =
  "You've reached us. Please leave a message after the tone and we'll get back to you.";

// Voicemail UX defaults applied to every <Record>. The beep cues the caller
// to start speaking; the cap bounds Twilio recording/storage cost and matches
// a typical voicemail length (2 minutes).
const VOICEMAIL_MAX_LENGTH_SECONDS = 120;

/**
 * Build the inbound-call TwiML for a `decideShared` decision. Each decision
 * kind maps to a Twilio verb:
 *   - ring-all     → one <Dial> with every reachable cell as a <Number>
 *                     child (Twilio rings them in parallel; first to answer
 *                     wins).
 *   - forward      → one <Dial> to the single forward-target cell.
 *   - round-robin  → one <Dial> to the single cell the cursor selected. The
 *                     returned nextCursor is the webhook's to persist; it is
 *                     never reflected in the TwiML.
 *   - voicemail    → a spoken greeting then a <Record> of the caller.
 */
export function buildVoiceTwiml(
  decision: DecideSharedResult,
  opts: VoiceTwimlOptions = {},
): string {
  const vr = new twilio.twiml.VoiceResponse();
  if (decision.kind === "ring-all") {
    const dial = vr.dial({ callerId: opts.callerId });
    for (const cell of decision.cells) {
      dial.number(cell);
    }
  } else if (decision.kind === "forward" || decision.kind === "round-robin") {
    const dial = vr.dial({ callerId: opts.callerId });
    dial.number(decision.cell);
  } else {
    vr.say(DEFAULT_VOICEMAIL_GREETING);
    const record: NonNullable<Parameters<typeof vr.record>[0]> = {
      playBeep: true,
      maxLength: VOICEMAIL_MAX_LENGTH_SECONDS,
    };
    if (opts.recordingStatusCallback) {
      record.recordingStatusCallback = opts.recordingStatusCallback;
    }
    if (opts.transcribeCallback) {
      record.transcribe = true;
      record.transcribeCallback = opts.transcribeCallback;
    }
    vr.record(record);
  }
  return vr.toString();
}

// ---------------------------------------------------------------------------
// Slice 10 (#314) — outbound bridge call. The Crew Lead clicks Call; Twilio
// rings their own cell first (a call FROM the Nookleus number), and when they
// answer, executes the TwiML below to bridge them to the customer. The
// customer's caller ID is the Nookleus number — the Crew Lead's real cell is
// never exposed. This is the caller-ID-spoofing safety property of the slice.
//
// We pass this TwiML INLINE on `calls.create({ twiml })` rather than hosting a
// webhook the call fetches: no customer number transits a URL, no extra
// signature-validated endpoint, and no answer-before-insert race. twilio-client
// is the only file allowed to import twilio, so the builder lives here.
// ---------------------------------------------------------------------------
export interface BridgeTwimlInput {
  // The customer's number to dial once the Crew Lead answers.
  customerE164: string;
  // The Nookleus number presented to the customer as caller ID.
  callerId: string;
}

export function buildBridgeTwiml(input: BridgeTwimlInput): string {
  const vr = new twilio.twiml.VoiceResponse();
  const dial = vr.dial({ callerId: input.callerId });
  dial.number(input.customerE164);
  return vr.toString();
}

export interface PlaceBridgeCallParams {
  // The Nookleus number. Caller ID the Crew Lead's cell sees on the leg
  // Twilio places to them, and (in the bridge twiml) the caller ID the
  // customer sees. Must be a Twilio-owned number.
  from: string;
  // The Crew Lead's own cell — rung first.
  to: string;
  // The inline bridge TwiML (from buildBridgeTwiml) executed on answer.
  twiml: string;
  // Our voice-status webhook; Twilio POSTs call-state transitions there.
  statusCallback?: string;
}

export interface PlaceBridgeCallResult {
  sid: string;
  status: string;
}

/**
 * Place the outbound bridge call. Rings `to` (the Crew Lead's cell) from
 * `from` (the Nookleus number); on answer Twilio executes the inline
 * `twiml` to dial the customer. Returns the outer-leg CallSid + initial
 * status (typically `'queued'`) — the route stores the SID so the
 * voice-status webhook can advance the row through ringing → in_progress →
 * completed.
 *
 * E.164 guards mirror sendSms: reject obviously-wrong numbers before the
 * network round-trip. Errors from the SDK propagate so the route can
 * surface them as a 502.
 */
export async function placeBridgeCall(
  client: TwilioClientLike,
  params: PlaceBridgeCallParams,
): Promise<PlaceBridgeCallResult> {
  if (!E164_RE.test(params.from)) {
    throw new Error(
      `twilio-client: placeBridgeCall from "${params.from}" must be E.164 (e.g. +15125551234)`,
    );
  }
  if (!E164_RE.test(params.to)) {
    throw new Error(
      `twilio-client: placeBridgeCall to "${params.to}" must be E.164 (e.g. +15125551234)`,
    );
  }
  if (!params.twiml) {
    throw new Error("twilio-client: placeBridgeCall requires non-empty twiml");
  }
  const payload: {
    from: string;
    to: string;
    twiml: string;
    statusCallback?: string;
    statusCallbackEvent?: string[];
  } = {
    from: params.from,
    to: params.to,
    twiml: params.twiml,
  };
  if (params.statusCallback) {
    payload.statusCallback = params.statusCallback;
    // Twilio's default is ['completed'] only. Opt into the whole lifecycle
    // so the row advances ringing → in-progress → completed in the thread,
    // not a single jump from queued to completed.
    payload.statusCallbackEvent = [
      "initiated",
      "ringing",
      "answered",
      "completed",
    ];
  }
  const created = await client.calls.create(payload);
  return { sid: created.sid, status: created.status };
}
