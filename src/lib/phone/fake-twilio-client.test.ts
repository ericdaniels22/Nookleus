// PRD #368 — Phone demo / dev mode. Slice 15a (#370).
//
// The fake provider is a pure, deterministic `TwilioClientLike` impl that
// lets the entire Phone surface (outbound send, number provision/release,
// the inbound HELP-reply) run with no carrier and no Twilio credentials.
// These tests pin the contract spelled out in the AC bullets of #370 —
// SID prefixes, synthetic inventory shape, no-op release, no I/O.

import { describe, it, expect } from "vitest";
import { createFakeTwilioClient } from "./fake-twilio-client";

describe("createFakeTwilioClient — messages.create", () => {
  it("returns an SM-prefixed non-empty SID with status 'queued'", async () => {
    const client = createFakeTwilioClient();

    const result = await client.messages.create({
      from: "+15125550000",
      to: "+15551234567",
      body: "hello from the fake provider",
    });

    expect(result.sid).toMatch(/^SM/);
    expect(result.sid.length).toBeGreaterThan(2);
    expect(result.status).toBe("queued");
  });

  it("accepts a mediaUrl array (MMS) without error", async () => {
    const client = createFakeTwilioClient();

    const result = await client.messages.create({
      from: "+15125550000",
      to: "+15551234567",
      body: "see attached",
      mediaUrl: [
        "https://signed/phone-attachments/org-1/a.jpg",
        "https://signed/phone-attachments/org-1/b.png",
      ],
    });

    expect(result.sid).toMatch(/^SM/);
    expect(result.status).toBe("queued");
  });
});

describe("createFakeTwilioClient — incomingPhoneNumbers.create", () => {
  it("returns a PN-prefixed SID and echoes the requested phoneNumber", async () => {
    const client = createFakeTwilioClient();

    const result = await client.incomingPhoneNumbers.create({
      phoneNumber: "+15125551234",
    });

    expect(result.sid).toMatch(/^PN/);
    expect(result.sid.length).toBeGreaterThan(2);
    expect(result.phoneNumber).toBe("+15125551234");
  });
});

describe("createFakeTwilioClient — incomingPhoneNumbers(sid).remove", () => {
  it("resolves (no-op release)", async () => {
    const client = createFakeTwilioClient();

    await expect(
      client.incomingPhoneNumbers("PNwhatever").remove(),
    ).resolves.not.toThrow();
  });
});

describe("createFakeTwilioClient — availablePhoneNumbers('US').local.list", () => {
  it("returns 3-5 synthetic entries shaped like Twilio's AvailableLocalNumber", async () => {
    const client = createFakeTwilioClient();

    const rows = await client
      .availablePhoneNumbers("US")
      .local.list({ areaCode: "512" });

    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.length).toBeLessThanOrEqual(5);

    for (const r of rows) {
      const row = r as Record<string, unknown>;
      expect(typeof row.phoneNumber).toBe("string");
      expect(String(row.phoneNumber)).not.toBe("");
      expect(typeof row.friendlyName).toBe("string");
      expect(String(row.friendlyName)).not.toBe("");
      // `locality` and `region` may be null per the real SDK; the spec
      // says "populated" so the fake should provide concrete values for
      // a believable demo.
      expect(row.locality).not.toBeNull();
      expect(row.locality).not.toBeUndefined();
      expect(row.region).not.toBeNull();
      expect(row.region).not.toBeUndefined();
    }
  });

  it("weaves the requested area code into the returned phone numbers", async () => {
    const client = createFakeTwilioClient();

    const rows = await client
      .availablePhoneNumbers("US")
      .local.list({ areaCode: "718" });

    for (const r of rows) {
      const row = r as Record<string, unknown>;
      expect(String(row.phoneNumber)).toMatch(/^\+1718\d{7}$/);
    }
  });
});
