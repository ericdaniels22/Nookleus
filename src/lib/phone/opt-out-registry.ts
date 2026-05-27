// PRD #304 — Nookleus Phone. Slice 5 (#309). TCPA STOP/HELP keyword
// classifier. Pure: no I/O, no Supabase, no HTTP. The persistence of the
// per-org opt-out registry (the `phone_opt_outs` table) is a thin shell
// that calls into this classifier on every inbound message.
//
// Carrier rule: STOP-side keywords trigger an opt-out and bind every
// number in the Organization to that outside-E.164 going forward, until
// an admin re-opts-in. HELP-side keywords trigger an auto-reply
// identifying the Organization and how to opt out.

const STOP_KEYWORDS: ReadonlySet<string> = new Set([
  "STOP",
  "UNSUBSCRIBE",
  "END",
  "QUIT",
  "CANCEL",
  "STOPALL",
]);

const HELP_KEYWORDS: ReadonlySet<string> = new Set(["HELP", "INFO"]);

export type OptOutKeyword = "stop" | "help";

/**
 * Classifies a Twilio inbound message body as a TCPA STOP, HELP, or
 * neither. Whole-body match, case-insensitive, leading/trailing
 * whitespace stripped. "stop calling me" → null (no whole-body match);
 * "stop" / "STOP" / "  STOP\n" → "stop".
 */
export function classifyOptOutKeyword(body: string): OptOutKeyword | null {
  const normalized = body.trim().toUpperCase();
  if (normalized.length === 0) return null;
  if (STOP_KEYWORDS.has(normalized)) return "stop";
  if (HELP_KEYWORDS.has(normalized)) return "help";
  return null;
}
