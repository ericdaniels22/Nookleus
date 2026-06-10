// PRD #304 — Nookleus Phone. Slice 11 (#315) — recording consent notice.
//
// The single source of truth for the legally-required consent notice spoken
// at the start of every recorded call (PRD stories 38/39; ADR 0006 — "the
// beep + spoken consent notice played at the start of every recorded call").
// One short, plain sentence that covers all 50 states, including two-party-
// consent jurisdictions.
//
// Both recorded-call TwiML paths speak THIS exact text: the inbound voice
// webhook and the outbound bridge call (buildVoiceTwiml / buildBridgeTwiml in
// twilio-client.ts) say it to the initiating party, and the per-leg "whisper"
// TwiML (buildConsentWhisperTwiml) plays it to the answering party. Settings
// copy quotes it too. Keeping the wording here — and nowhere else — means the
// two legal surfaces can never drift, and recording-consent.test.ts pins it so
// a wording change is always a deliberate, reviewed snapshot update.

/** The canonical spoken + displayed call-recording consent notice. */
export const RECORDING_CONSENT_NOTICE =
  "This call may be recorded for quality and reference.";
