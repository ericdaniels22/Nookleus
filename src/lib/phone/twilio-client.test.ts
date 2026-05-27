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

import { describe, it, expect, vi } from "vitest";
import {
  listAvailableLocalNumbers,
  provisionNumber,
  releaseNumber,
  type TwilioClientLike,
} from "./twilio-client";

function fakeClient(opts: {
  listResult?: unknown[];
  createResult?: { sid: string; phoneNumber: string };
  removeImpl?: () => Promise<void>;
  listSpy?: ReturnType<typeof vi.fn>;
  createSpy?: ReturnType<typeof vi.fn>;
  removeSpy?: ReturnType<typeof vi.fn>;
}): TwilioClientLike {
  const list = opts.listSpy ?? vi.fn(async () => opts.listResult ?? []);
  const create =
    opts.createSpy ??
    vi.fn(async () => opts.createResult ?? { sid: "PNxxx", phoneNumber: "+15555550100" });
  const remove = opts.removeSpy ?? vi.fn(opts.removeImpl ?? (async () => undefined));
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
