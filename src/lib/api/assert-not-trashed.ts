// Tiny gate used at every mutating route on a soft-deletable resource.
// Returns null if the row is active, or a 404 NextResponse if the row is
// trashed. Used as:
//
//   const trashed = assertNotTrashed(row);
//   if (trashed) return trashed;
//
// 404 (rather than 410 Gone) is intentional: it lets the existing auto-save
// retry/backoff handler treat trash as terminal-stop without a new branch.

import { NextResponse } from "next/server";

export function assertNotTrashed(
  row: { deleted_at: string | null } | null,
): NextResponse | null {
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.deleted_at !== null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return null;
}
