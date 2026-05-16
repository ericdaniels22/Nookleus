import type { ContractStatus } from "./types";

// The deep module behind issue #76's permanent-delete feature: it is the
// single place the "may this contract template be hard-deleted?" rule
// lives. Pure — no DB, no I/O. The usage endpoint feeds it the referencing
// contracts to drive the confirm/block dialog; the hard_delete RPC encodes
// the same rule in SQL as the authoritative gate.

export interface ReferencingContract {
  id: string;
  status: ContractStatus;
}

export interface TemplateDeletionEligibility {
  // false when at least one referencing contract is mid-signing.
  deletable: boolean;
  // Contracts that block the delete — `sent` / `viewed` (a customer is
  // currently mid-signing). Empty when deletable.
  blockers: ReferencingContract[];
  // Ids of `draft` referencing contracts. These cascade-delete with the
  // template; the confirm dialog discloses the count.
  draftIds: string[];
}

// A signed contract is already its own stamped PDF, so a *history* of use
// never protects a template — only work-in-progress does. Deletion is
// refused in exactly one situation: a referencing contract is `sent` or
// `viewed` (a customer is mid-signing). `draft` contracts cascade-delete;
// `signed` / `expired` / `voided` contracts are retained (their template_id
// is nulled by the FK ON DELETE SET NULL).
export function evaluateTemplateDeletion(
  referencingContracts: ReferencingContract[],
): TemplateDeletionEligibility {
  const blockers = referencingContracts.filter(
    (c) => c.status === "sent" || c.status === "viewed",
  );
  const draftIds = referencingContracts
    .filter((c) => c.status === "draft")
    .map((c) => c.id);

  return {
    deletable: blockers.length === 0,
    blockers,
    draftIds,
  };
}
