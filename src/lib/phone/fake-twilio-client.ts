// PRD #304 — Nookleus Phone. Slice 15 (#368) — fake Twilio provider.
//
// A pure, deterministic in-process implementation of the existing
// `TwilioClientLike` interface from `./twilio-client`. The factory
// `createTwilioClient()` returns this fake when the server-side flag
// `NOOKLEUS_PHONE_DEMO_MODE === 'true'` is set, so the whole Phone feature
// can run end-to-end with no carrier and no Twilio credentials. Everything
// *except* the two carrier hops (outbound send + inbound webhook) runs for
// real against the dev database — outbound-number selection, TCPA opt-out,
// smart-attach, Conversation threading, RLS / access matrix, realtime push.
// Only the carrier itself is faked.
//
// Contract (per #368):
//   - messages.create({...})                    → { sid: 'SM…', status: 'queued' }
//   - availablePhoneNumbers('US').local.list({areaCode})
//                                               → 3–5 synthetic local numbers
//   - incomingPhoneNumbers.create({phoneNumber}) → { sid: 'PN…', phoneNumber }
//   - incomingPhoneNumbers(sid).remove()        → resolves (no-op)
//
// Pure: no I/O, no network, no clock-dependent behavior in the returned
// shapes (apart from the SID, which is unique-per-call to mirror Twilio).

import type { TwilioClientLike } from "./twilio-client";

// A short pseudo-random tail mirroring Twilio's SID format (32-char hex
// after the 2-char prefix). The fake doesn't need cryptographic strength;
// it just needs uniqueness across messages in a session and a recognisable
// shape so demo recordings look right.
function fakeSidTail(): string {
  return (
    Math.random().toString(16).slice(2, 18) +
    Math.random().toString(16).slice(2, 18)
  ).slice(0, 32);
}

// Three synthetic local numbers per area-code query. The locality / region
// is the same demo fiction every time, so a recorded demo is repeatable.
// The numbers are inside the +1<area><555>00XX block to guarantee they
// can never collide with a real subscriber line.
function fakeAvailableLocalNumbers(areaCode: string) {
  return [
    {
      phoneNumber: `+1${areaCode}5550101`,
      friendlyName: `(${areaCode}) 555-0101`,
      locality: "Austin",
      region: "TX",
    },
    {
      phoneNumber: `+1${areaCode}5550102`,
      friendlyName: `(${areaCode}) 555-0102`,
      locality: "Austin",
      region: "TX",
    },
    {
      phoneNumber: `+1${areaCode}5550103`,
      friendlyName: `(${areaCode}) 555-0103`,
      locality: "Round Rock",
      region: "TX",
    },
  ];
}

/**
 * Build a fake `TwilioClientLike` for demo / dev mode (#368). The returned
 * object satisfies the same structural interface as the real Twilio SDK
 * client constructed by `createTwilioClient()` — `messages.create`,
 * `availablePhoneNumbers('US').local.list`, `incomingPhoneNumbers.create`,
 * `incomingPhoneNumbers(sid).remove()` — so every call site stays unaware
 * of the swap.
 */
export function createFakeTwilioClient(): TwilioClientLike {
  // Mirrors Twilio's dual-shape `incomingPhoneNumbers`: callable as
  // `client.incomingPhoneNumbers(sid)` returning a single-resource shape,
  // AND carrying a `.create` method to provision a new one.
  const incomingPhoneNumbers = Object.assign(
    (_sid: string) => ({
      async remove() {
        return undefined;
      },
    }),
    {
      async create(opts: { phoneNumber: string }) {
        return {
          sid: `PN${fakeSidTail()}`,
          phoneNumber: opts.phoneNumber,
        };
      },
    },
  );

  return {
    availablePhoneNumbers: (_country: string) => ({
      local: {
        async list(opts: { areaCode: string; limit?: number }) {
          return fakeAvailableLocalNumbers(opts.areaCode);
        },
      },
    }),
    incomingPhoneNumbers,
    // recordings(sid).remove() → resolves (no-op). Demo voicemails have no real
    // Twilio recording to hard-delete; the deletion path still runs end-to-end.
    recordings: (_sid: string) => ({
      async remove() {
        return undefined;
      },
    }),
    messages: {
      async create(_opts: {
        from: string;
        to: string;
        body: string;
        statusCallback?: string;
        mediaUrl?: string[];
      }) {
        return {
          sid: `SM${fakeSidTail()}`,
          status: "queued",
        };
      },
    },
    // Slice 10 (#314) — outbound bridge call. Mirrors Twilio's
    // `calls.create`: a CA-prefixed SID and an initial 'queued' status. The
    // demo provider never actually rings a phone; the voice-status webhook
    // can be driven by the dev simulate route to advance the lifecycle.
    calls: {
      async create(_opts: {
        from: string;
        to: string;
        twiml: string;
        statusCallback?: string;
        statusCallbackEvent?: string[];
        statusCallbackMethod?: string;
      }) {
        return {
          sid: `CA${fakeSidTail()}`,
          status: "queued",
        };
      },
    },
  };
}
