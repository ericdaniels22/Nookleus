// PRD #304 — Nookleus Phone. Slice 15 (#368) — fake Twilio provider.
//
// The `fake-twilio-client` is a deterministic, pure implementation of the
// existing `TwilioClientLike` interface from `./twilio-client`. It exists so
// that when `NOOKLEUS_PHONE_DEMO_MODE === 'true'` the `createTwilioClient()`
// factory returns this fake instead of constructing the real SDK — the rest
// of the Phone feature (number selection, opt-out enforcement, smart-attach,
// threading, RLS, the Shared/Personal access matrix, realtime) all runs for
// real against the dev database, only the carrier hops are faked.
//
// These tests exercise the contract surface the production code paths
// actually touch — minus test-only spies (the established `fakeClient()`
// shape in `./twilio-client.test.ts` is the prior art).

import { describe, it, expect } from "vitest";
import { createFakeTwilioClient } from "./fake-twilio-client";
import {
  buildBridgeTwiml,
  listAvailableLocalNumbers,
  placeBridgeCall,
  provisionNumber,
  releaseNumber,
  sendSms,
} from "./twilio-client";

describe("createFakeTwilioClient — messages.create (outbound SMS)", () => {
  it("returns an SM-prefixed SID and 'queued' status", async () => {
    const client = createFakeTwilioClient();

    const result = await sendSms(client, {
      from: "+15125550000",
      to: "+15551234567",
      body: "hello from the fake",
    });

    expect(result.sid).toMatch(/^SM/);
    expect(result.sid.length).toBeGreaterThan(2);
    expect(result.status).toBe("queued");
  });

  it("returns a non-empty SID even for MMS (body empty, mediaUrl present)", async () => {
    const client = createFakeTwilioClient();

    const result = await sendSms(client, {
      from: "+15125550000",
      to: "+15551234567",
      body: "",
      mediaUrl: ["https://example.com/img.jpg"],
    });

    expect(result.sid).toMatch(/^SM/);
    expect(result.status).toBe("queued");
  });
});

describe("createFakeTwilioClient — availablePhoneNumbers list (number picker)", () => {
  it("returns a small fixed local-numbers inventory for any US area code", async () => {
    const client = createFakeTwilioClient();

    const list = await listAvailableLocalNumbers(client, "512");

    // 3–5 synthetic local numbers per the issue body.
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.length).toBeLessThanOrEqual(5);
    for (const n of list) {
      expect(typeof n.phoneNumber).toBe("string");
      expect(n.phoneNumber).toMatch(/^\+1\d{10}$/);
      expect(typeof n.friendlyName).toBe("string");
      expect(n.friendlyName.length).toBeGreaterThan(0);
      expect(typeof n.locality === "string" || n.locality === null).toBe(true);
      expect(typeof n.region === "string" || n.region === null).toBe(true);
    }
  });

  it("includes the requested area code in the synthesized numbers", async () => {
    const client = createFakeTwilioClient();

    const list = await listAvailableLocalNumbers(client, "737");

    // At least one of the synthetic numbers should reflect the area
    // code the caller asked for — otherwise the demo's "search by area
    // code" UI gives the same result regardless of input, which is a
    // weaker demo than necessary.
    expect(list.some((n) => n.phoneNumber.startsWith("+1737"))).toBe(true);
  });
});

describe("createFakeTwilioClient — incomingPhoneNumbers.create (provision)", () => {
  it("returns a PN-prefixed SID and echoes the phoneNumber", async () => {
    const client = createFakeTwilioClient();

    const result = await provisionNumber(client, "+15125550100");

    expect(result.sid).toMatch(/^PN/);
    expect(result.sid.length).toBeGreaterThan(2);
    expect(result.phoneNumber).toBe("+15125550100");
  });
});

describe("createFakeTwilioClient — incomingPhoneNumbers(sid).remove (release)", () => {
  it("resolves with no error (no-op)", async () => {
    const client = createFakeTwilioClient();

    await expect(releaseNumber(client, "PNfake")).resolves.toBeUndefined();
  });
});

describe("createFakeTwilioClient — calls.create (outbound bridge call, #314)", () => {
  it("returns a CA-prefixed SID and 'queued' status", async () => {
    const client = createFakeTwilioClient();

    const result = await placeBridgeCall(client, {
      from: "+15125550000",
      to: "+15129990000",
      twiml: buildBridgeTwiml({
        customerE164: "+15551234567",
        callerId: "+15125550000",
      }),
      statusCallback: "https://example.com/voice-status",
    });

    expect(result.sid).toMatch(/^CA/);
    expect(result.sid.length).toBeGreaterThan(2);
    expect(result.status).toBe("queued");
  });
});
