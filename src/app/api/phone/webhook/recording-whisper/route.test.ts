// PRD #304 — Nookleus Phone. Slice 11 (#315) — recording-consent whisper.
//
// Twilio fetches this endpoint via each recorded call's `<Number url>` whisper
// and plays the returned TwiML to the ANSWERING party before bridging — so
// both parties hear the consent notice (the initiating party hears it via the
// <Say> before the <Dial>). Like every Twilio-facing endpoint it is gated
// solely by the X-Twilio-Signature HMAC.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RECORDING_CONSENT_NOTICE } from "@/lib/phone/recording-consent";

const validateSignatureMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", async (importOriginal) => {
  // Keep buildConsentWhisperTwiml REAL so the test pins that the actual consent
  // notice reaches the wire; mock only the signature check.
  const actual =
    await importOriginal<typeof import("@/lib/phone/twilio-client")>();
  return {
    ...actual,
    validateTwilioSignature: (...a: unknown[]) => validateSignatureMock(...a),
  };
});

import { POST } from "./route";

function whisperReq(signature: string | null = "valid"): Request {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (signature !== null) headers["x-twilio-signature"] = signature;
  return new Request("http://test/api/phone/webhook/recording-whisper", {
    method: "POST",
    headers,
    body: new URLSearchParams({ CallSid: "CA-1" }).toString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  validateSignatureMock.mockReturnValue(true);
});

describe("recording-whisper webhook (#315)", () => {
  it("serves the consent-notice TwiML on a valid Twilio signature", async () => {
    const res = await POST(whisperReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const body = await res.text();
    expect(body).toContain("<Say");
    expect(body).toContain(RECORDING_CONSENT_NOTICE);
  });

  it("403s on an invalid Twilio signature", async () => {
    validateSignatureMock.mockReturnValue(false);
    const res = await POST(whisperReq("bad"));
    expect(res.status).toBe(403);
  });
});
