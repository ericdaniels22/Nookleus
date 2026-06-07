// PRD #304 — Nookleus Phone. Slice 8 (#312). Inbound Shared-number
// routing decision. Pure: no I/O.
//
// ADR 0006 gives Shared numbers four inbound answer rules — ring-all /
// round-robin / forward / voicemail — configured per-number on
// `phone_numbers.inbound_rule` (jsonb, Shared-only; Personal numbers
// always go to voicemail and never reach here). The inbound voice
// webhook hands this function the number's rule, the org roster, and the
// number's persisted round-robin cursor; this returns the dial decision
// the webhook turns into TwiML.
//
// Slice-8 design decision (issue #312, Q2): ring-all and round-robin dial
// *only the members an admin manually selected* into the rule — there is
// no role-derived roster. The selected user ids are resolved against the
// roster, members without a cell on file are skipped, and "nobody
// reachable" collapses to voicemail (a customer never hears dead air).

export type InboundRule =
  | { kind: "ring-all"; users: string[] }
  | { kind: "round-robin"; sequence: string[] }
  | { kind: "forward"; forwardUserId: string }
  | { kind: "voicemail" };

export interface RoutableMember {
  userId: string;
  /** The member's cell on file (E.164), or null when none is set. */
  cellE164: string | null;
}

export interface DecideSharedInput {
  /** The Shared number's inbound_rule. NULL = unconfigured (slice 3 inserts NULL). */
  config: InboundRule | null;
  /** Org roster, used to resolve selected user ids to reachable cells. */
  members: RoutableMember[];
  /** Persisted rotation cursor for this number; monotonic, 0 if never rung. */
  roundRobinCursor: number;
  /** Layer-2 placeholder for business-hours routing; unused today. */
  currentHour?: number;
}

export type DecideSharedResult =
  | { kind: "ring-all"; cells: string[] }
  | { kind: "round-robin"; cell: string; nextCursor: number }
  | { kind: "forward"; cell: string }
  | { kind: "voicemail" };

const VOICEMAIL: DecideSharedResult = { kind: "voicemail" };

/** Resolve selected user ids to their cells, in selection order, dropping
 *  anyone without a cell on file. */
function resolveCells(
  userIds: string[],
  members: RoutableMember[],
): string[] {
  const byId = new Map(members.map((m) => [m.userId, m.cellE164]));
  return userIds
    .map((id) => byId.get(id) ?? null)
    .filter((cell): cell is string => cell !== null);
}

export function decideShared(input: DecideSharedInput): DecideSharedResult {
  const { config } = input;

  if (config?.kind === "ring-all") {
    const cells = resolveCells(config.users, input.members);
    return cells.length > 0 ? { kind: "ring-all", cells } : VOICEMAIL;
  }

  if (config?.kind === "round-robin") {
    const cells = resolveCells(config.sequence, input.members);
    if (cells.length === 0) return VOICEMAIL;
    return {
      kind: "round-robin",
      cell: cells[input.roundRobinCursor % cells.length],
      nextCursor: input.roundRobinCursor + 1,
    };
  }

  if (config?.kind === "forward") {
    const [cell] = resolveCells([config.forwardUserId], input.members);
    return cell ? { kind: "forward", cell } : VOICEMAIL;
  }

  return VOICEMAIL;
}
