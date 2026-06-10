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
  // Slice 13 (#317) — per-message picker override. When set, the caller has
  // explicitly chosen which number to send from in the compose box. It must
  // resolve to a number the caller is permitted to send from (see
  // `callerMaySendFrom`); otherwise the result is `forbidden_override` rather
  // than a silent fall-back, so the route can refuse rather than send from a
  // surprise number. Null/undefined means "no override — apply the default
  // rule".
  overrideNumberId?: string | null;
}

export type SelectOutboundNumberResult =
  | { kind: "picked"; number: SelectableNumber }
  | { kind: "none" }
  // The override pointed at a number the caller can't send from — not in the
  // org, released/inactive, or another user's Personal number.
  | { kind: "forbidden_override" };

function isUsable(n: SelectableNumber, organizationId: string): boolean {
  return (
    n.organization_id === organizationId &&
    n.released_at === null &&
    n.is_active === true
  );
}

// Which of the org's numbers may THIS caller send from: any usable Shared
// (the org switchboard is shared by all members), plus the caller's own
// usable Personal number. A teammate's Personal number is never sendable —
// sending from it would impersonate them and leak across the ADR 0005
// content-privacy boundary.
function callerMaySendFrom(
  n: SelectableNumber,
  callerUserId: string,
  organizationId: string,
): boolean {
  if (!isUsable(n, organizationId)) return false;
  if (n.kind === "shared") return true;
  return n.kind === "personal" && n.user_id === callerUserId;
}

/**
 * The numbers the caller is allowed to send from, in display order: the
 * caller's own Personal number first (the default), then Shared numbers
 * earliest-created first. This is the source list for the compose-box
 * per-message picker.
 */
export function selectableOutboundNumbers(input: {
  callerUserId: string;
  organizationId: string;
  orgNumbers: SelectableNumber[];
}): SelectableNumber[] {
  const permitted = input.orgNumbers.filter((n) =>
    callerMaySendFrom(n, input.callerUserId, input.organizationId),
  );
  return permitted.sort((a, b) => {
    const aOwn = a.kind === "personal" ? 0 : 1;
    const bOwn = b.kind === "personal" ? 0 : 1;
    if (aOwn !== bOwn) return aOwn - bOwn;
    return a.created_at.localeCompare(b.created_at);
  });
}

export function selectOutboundNumber(
  input: SelectOutboundNumberInput,
): SelectOutboundNumberResult {
  const permitted = input.orgNumbers.filter((n) =>
    callerMaySendFrom(n, input.callerUserId, input.organizationId),
  );

  // Per-message override beats the default rule, but only within the set the
  // caller is actually permitted to send from.
  if (input.overrideNumberId != null) {
    const chosen = permitted.find((n) => n.id === input.overrideNumberId);
    if (chosen) return { kind: "picked", number: chosen };
    return { kind: "forbidden_override" };
  }

  const personal = permitted.find(
    (n) => n.kind === "personal" && n.user_id === input.callerUserId,
  );
  if (personal) return { kind: "picked", number: personal };

  const shared = permitted
    .filter((n) => n.kind === "shared")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (shared) return { kind: "picked", number: shared };

  return { kind: "none" };
}
