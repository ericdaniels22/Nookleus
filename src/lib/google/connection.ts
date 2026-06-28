// The Google connection store: deriving its public state from a row, and the
// org-scoped reads/writes the routes and deep module lean on.
//
// Org scoping is EXPLICIT here — every function takes an organizationId and
// filters on it. This is a deliberate departure from qb's getActiveConnection,
// which has no org filter (safe only because QB is single-tenant today). The
// Marketing Suite is multi-tenant from day one (PRD #603), so a connection is
// only ever read or mutated within a named Organization.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GoogleConnectionRow,
  GoogleConnectionState,
  GoogleConnectionSummary,
} from "./types";

// A row (or its absence) maps onto exactly one state. No row means
// disconnected — disconnect deletes the row, so absence IS the state.
export function deriveConnectionState(
  row: GoogleConnectionRow | null,
): GoogleConnectionState {
  if (!row) return "disconnected";
  return row.status === "broken" ? "broken" : "connected";
}

// The token-free view the Settings UI renders.
export function toConnectionSummary(
  row: GoogleConnectionRow | null,
): GoogleConnectionSummary {
  if (!row) {
    return {
      state: "disconnected",
      account_email: null,
      account_name: null,
      scopes: [],
      broken_reason: null,
      connected_at: null,
    };
  }
  return {
    state: deriveConnectionState(row),
    account_email: row.google_account_email,
    account_name: row.google_account_name,
    scopes: row.scopes,
    broken_reason: row.broken_reason,
    connected_at: row.created_at,
  };
}

// The Organization's single connection, or null. Org-scoped (see header).
export async function getGoogleConnection(
  db: SupabaseClient,
  organizationId: string,
): Promise<GoogleConnectionRow | null> {
  const { data } = await db
    .from("google_connection")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle<GoogleConnectionRow>();
  return data ?? null;
}

// Flip a connection to the broken state. Called by the token chokepoint when a
// refresh is rejected with invalid_grant (revoked at Google or expired) — never
// on a transient error. The UI reads 'broken' as "show the reconnect prompt".
export async function markBroken(
  db: SupabaseClient,
  connectionId: string,
  reason: string,
): Promise<void> {
  const { error } = await db
    .from("google_connection")
    .update({
      status: "broken",
      broken_reason: reason,
      broken_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
  // A failed flip is worth a loud line: the row stays 'connected' while the
  // chokepoint returns null, so the UI won't show the reconnect prompt and the
  // next call just retries the doomed refresh. Don't let that fail silently.
  if (error) {
    console.error(
      `[google] FAILED to mark connection ${connectionId} broken (${reason}): ${error.message}`,
    );
    return;
  }
  console.warn(`[google] connection ${connectionId} marked broken: ${reason}`);
}

// Remove the Organization's connection entirely. Disconnect deletes rather than
// retains: the credential never lingers locally after the user disconnects.
export async function deleteConnection(
  db: SupabaseClient,
  organizationId: string,
): Promise<void> {
  const { error } = await db
    .from("google_connection")
    .delete()
    .eq("organization_id", organizationId);
  if (error) {
    console.error(
      `[google] FAILED to delete connection for org ${organizationId}: ${error.message}`,
    );
  }
}
