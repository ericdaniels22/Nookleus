import type { ContractStatus } from "./types";

// Subset of Contract surface that drives the restore-target derivation.
// Keeping the input narrow (just the three timestamps) means callers can
// pass list-view rows, full Contract rows, or hand-built fixtures without
// ceremony.
export interface RestoreTargetInputs {
  signed_at: string | null;
  first_viewed_at: string | null;
  sent_at: string | null;
}

export function computeRestoreTargetStatus(
  c: RestoreTargetInputs,
): ContractStatus {
  if (c.signed_at !== null) return "signed";
  if (c.first_viewed_at !== null) return "viewed";
  if (c.sent_at !== null) return "sent";
  return "draft";
}
