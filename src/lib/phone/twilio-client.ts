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
  messages: {
    create(opts: {
      from: string;
      to: string;
      body: string;
      statusCallback?: string;
      mediaUrl?: string[];
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

export interface SendSmsParams {
  from: string;
  to: string;
  body: string;
  statusCallback?: string;
  // Slice 6 (#310) — MMS attachments. Each entry is a publicly-fetchable
  // URL Twilio downloads from; pass an empty/undefined array for plain SMS.
  // An MMS may carry an empty body provided at least one mediaUrl is set.
  mediaUrl?: string[];
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
  } = {
    from: params.from,
    to: params.to,
    body: params.body,
  };
  if (params.statusCallback) payload.statusCallback = params.statusCallback;
  if (hasMedia) payload.mediaUrl = params.mediaUrl;
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
  // PRD #368, slice 15a (#370) — Phone demo / dev mode. When the
  // server-side `NOOKLEUS_PHONE_DEMO_MODE` flag is set, the whole Phone
  // surface runs against an in-process fake provider so demos and
  // ongoing slice 6–13 development can proceed while #305 (A2P 10DLC
  // carrier registration) is in carrier review. The production-side
  // throw is the fail-safe — a fake must never silently swallow a real
  // customer's SMS.
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
