// PRD #304 — Nookleus Phone. Slice 8 (#312) — inbound-rule validation.
//
// The trust boundary between the Settings → Phone editor's PATCH body
// (untrusted JSON) and the `phone_numbers.inbound_rule` jsonb column.
// Accepts only the four shapes `decideShared` understands and rejects
// everything else with a human-readable error. Pure: no I/O.

import type { InboundRule } from "./route-shared-call";

export type ParseInboundRuleResult =
  | { ok: true; rule: InboundRule }
  | { ok: false; error: string };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function parseInboundRule(raw: unknown): ParseInboundRuleResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "inbound_rule must be an object" };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.kind === "ring-all") {
    if (!isStringArray(obj.users)) {
      return { ok: false, error: "ring-all requires a users string array" };
    }
    return { ok: true, rule: { kind: "ring-all", users: obj.users } };
  }

  if (obj.kind === "round-robin") {
    if (!isStringArray(obj.sequence)) {
      return { ok: false, error: "round-robin requires a sequence string array" };
    }
    return { ok: true, rule: { kind: "round-robin", sequence: obj.sequence } };
  }

  if (obj.kind === "forward") {
    if (typeof obj.forwardUserId !== "string") {
      return { ok: false, error: "forward requires a forwardUserId string" };
    }
    return { ok: true, rule: { kind: "forward", forwardUserId: obj.forwardUserId } };
  }

  if (obj.kind === "voicemail") {
    return { ok: true, rule: { kind: "voicemail" } };
  }

  return { ok: false, error: `unknown inbound_rule kind "${String(obj.kind)}"` };
}
