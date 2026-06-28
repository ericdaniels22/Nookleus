// Pure helper for duplicating a Line item (issue #683).
//
// Isolated from React so it can be unit tested in plain Node and reused across
// the template, estimate, and invoice builder modes. It clones every editable
// field of a row but drops the row's server identity — its id is replaced with a
// fresh client id and the created_at / updated_at timestamps are removed — so the
// result is a brand-new row, not a second reference to the original.
//
// For Estimate / Invoice the result feeds the create POST body (the server
// assigns the real id and timestamps); for template mode the result is spliced
// straight into local state with its fresh client id. Equipment fields
// (pricing_mode / pieces / days) are carried generically by the shallow clone.

export function duplicateLineItem<I extends { id: string }>(item: I): I {
  const clone = { ...item, id: crypto.randomUUID() } as Record<string, unknown>;
  delete clone.created_at;
  delete clone.updated_at;
  return clone as I;
}
