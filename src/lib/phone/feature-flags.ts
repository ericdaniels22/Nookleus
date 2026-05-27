// PRD #304 — Nookleus Phone. Slice 5 (#309).
//
// `isPhoneOutboundEnabled()` is the single source of truth for whether
// the outbound SMS surface is live. Gated because issue #309 is blocked
// by #305 (A2P 10DLC carrier registration) — until the campaign clears,
// US carriers will reject our outbound business SMS at the gateway.
//
// The env var is `NEXT_PUBLIC_*` so the same value flows into both the
// server runtime (the route gate) and the client bundle (the UI hide).
// Strict "true" string: avoids the classic JS truthy-string footgun
// where any non-empty value reads as enabled.
//
// To enable in prod the day A2P clears:
//   1. Set `NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED=true` in Vercel.
//   2. Redeploy. The client bundle inlines the var at build time, so a
//      redeploy is required; a runtime env-var flip on the server alone
//      will not change the client UI.

export function isPhoneOutboundEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED === "true";
}
