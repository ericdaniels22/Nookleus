// PRD #304 — Nookleus Phone. Slice 11 (#315) — recording-consent legal pin.
//
// The consent notice is legally load-bearing (ADR 0006: "the beep + spoken
// consent notice played at the start of every recorded call"; PRD stories
// 38/39 — legal across all 50 states incl. two-party-consent jurisdictions).
// This file is the legal-text pin: it snapshots the canonical wording so the
// notice can never change silently — editing the wording is a deliberate
// snapshot update, reviewed on its own. Nothing else in slice 11 touches this
// file's snapshots.

import { describe, it, expect } from "vitest";
import { RECORDING_CONSENT_NOTICE } from "./recording-consent";
import { buildConsentWhisperTwiml } from "./twilio-client";

describe("recording-consent — legal-text pin (#315)", () => {
  it("pins the canonical spoken/display consent notice", () => {
    expect(RECORDING_CONSENT_NOTICE).toMatchInlineSnapshot(
      `"This call may be recorded for quality and reference."`,
    );
  });

  // The consent notice as it actually reaches the answering party of a
  // recorded call — the TwiML the recording-whisper endpoint serves. Pinned
  // here so the spoken fragment and the display string change together, never
  // silently.
  it("pins the consent notice as the spoken TwiML fragment", () => {
    expect(buildConsentWhisperTwiml()).toMatchInlineSnapshot(`"<?xml version="1.0" encoding="UTF-8"?><Response><Say>This call may be recorded for quality and reference.</Say></Response>"`);
  });
});
