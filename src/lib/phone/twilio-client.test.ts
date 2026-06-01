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
  createTwilioClient,
  listAvailableLocalNumbers,
  provisionNumber,
  releaseNumber,
  sendSms,
  type TwilioClientLike,
} from "./twilio-client";

function fakeClient(opts: {
  listResult?: unknown[];
  createResult?: { sid: string; phoneNumber: string };
  removeImpl?: () => Promise<void>;
  messageCreateResult?: { sid: string; status: string };
  messageCreateImpl?: (params: unknown) => Promise<unknown>;
  listSpy?: ReturnType<typeof vi.fn>;
  createSpy?: ReturnType<typeof vi.fn>;
  removeSpy?: ReturnType<typeof vi.fn>;
  messageCreateSpy?: ReturnType<typeof vi.fn>;
}): TwilioClientLike {
  const list = opts.listSpy ?? vi.fn(async () => opts.listResult ?? []);
  const create =
    opts.createSpy ??
    vi.fn(async () => opts.createResult ?? { sid: "PNxxx", phoneNumber: "+15555550100" });
  const remove = opts.removeSpy ?? vi.fn(opts.removeImpl ?? (async () => undefined));
  const messageCreate =
    opts.messageCreateSpy ??
    vi.fn(
      opts.messageCreateImpl ??
        (async () => opts.messageCreateResult ?? { sid: "SMabc", status: "queued" }),
    );
  // Twilio SDK shape: `incomingPhoneNumbers` is callable (sid) → resource AND
  // has a `.create` method. We replicate that surface here so the helper
  // can stay byte-identical between fake and real client.
  const incomingPhoneNumbers = Object.assign(
    (_sid: string) => ({ remove }),
    { create },
  );
  return {
    availablePhoneNumbers: (_country: string) => ({ local: { list } }),
    incomingPhoneNumbers,
    messages: { create: messageCreate },
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
