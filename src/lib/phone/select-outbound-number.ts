// PRD #304 — Nookleus Phone. Slice 5 (#309). Outbound-number selection
// rule. Pure: no I/O. The route hands in every `phone_numbers` row in the
// caller's active org; this returns the one to send from (or `none` if
// the org has nothing live).
//
// Rule, from PRD #304 § Outbound number selection:
//   1. The caller's active Personal number, if they have one.
//   2. Otherwise, the org's "primary" Shared number — defined as the
//      earliest-created active Shared, since the schema carries no
//      explicit primary flag yet.
//
// Slice 5 never reaches the Personal branch (Personal numbers come in
// slice 13); the branch ships now so slice 13 is a one-line UI change.

export interface SelectableNumber {
  id: string;
  organization_id: string;
  e164: string;
  kind: "shared" | "personal";
  user_id: string | null;
  released_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface SelectOutboundNumberInput {
  callerUserId: string;
  organizationId: string;
  orgNumbers: SelectableNumber[];
}

export type SelectOutboundNumberResult =
  | { kind: "picked"; number: SelectableNumber }
  | { kind: "none" };

function isUsable(n: SelectableNumber, organizationId: string): boolean {
  return (
    n.organization_id === organizationId &&
    n.released_at === null &&
    n.is_active === true
  );
}

export function selectOutboundNumber(
  input: SelectOutboundNumberInput,
): SelectOutboundNumberResult {
  const usable = input.orgNumbers.filter((n) =>
    isUsable(n, input.organizationId),
  );

  const personal = usable.find(
    (n) => n.kind === "personal" && n.user_id === input.callerUserId,
  );
  if (personal) return { kind: "picked", number: personal };

  const shared = usable
    .filter((n) => n.kind === "shared")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (shared) return { kind: "picked", number: shared };

  return { kind: "none" };
}
