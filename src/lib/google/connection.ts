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
import { GOOGLE_TESTING_REFRESH_TOKEN_TTL_DAYS } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;
// How close to expiry the Marketing page escalates from a quiet dot to an amber
// "reconnect soon" banner.
const EXPIRING_WITHIN_MS = 2 * DAY_MS;

// A row (or its absence) maps onto exactly one state. No row means
// disconnected — disconnect deletes the row, so absence IS the state.
export function deriveConnectionState(
  row: GoogleConnectionRow | null,
): GoogleConnectionState {
  if (!row) return "disconnected";
  return row.status === "broken" ? "broken" : "connected";
}

// When the current Testing-mode refresh token expires, or null when there is no
// expiry to surface (Production, or no consent time). Pure and env-agnostic: the
// caller passes testingMode so the same row maps to a countdown or to nothing
// purely by publishing status. See isGoogleOAuthTestingMode() (#789).
export function refreshTokenExpiresAt(
  lastConsentedAtIso: string | null | undefined,
  opts: { testingMode: boolean; ttlDays?: number },
): string | null {
  if (!opts.testingMode) return null;
  if (!lastConsentedAtIso) return null;
  const consentedMs = Date.parse(lastConsentedAtIso);
  if (Number.isNaN(consentedMs)) return null;
  const ttlDays = opts.ttlDays ?? GOOGLE_TESTING_REFRESH_TOKEN_TTL_DAYS;
  return new Date(consentedMs + ttlDays * DAY_MS).toISOString();
}

// What the Marketing page shows about the Google connection's health. 'none' is
// the silent case (healthy-and-early, Production, or no connection); 'ok' is a
// quiet "Nd left"; 'expiring'/'expired' are the proactive warnings; 'broken' is
// the already-failed connection.
export type MarketingGoogleIndicator =
  | { kind: "none" }
  | { kind: "ok"; daysRemaining: number }
  | { kind: "expiring"; daysRemaining: number }
  | { kind: "expired" }
  | { kind: "broken" };

// Decide that indicator from the token-free summary and the current time. Pure,
// so the Marketing page stays a thin switch over this (testable) decision.
export function marketingGoogleIndicator(
  summary: Pick<GoogleConnectionSummary, "state" | "token_expires_at"> | null,
  nowMs: number,
): MarketingGoogleIndicator {
  if (!summary || summary.state === "disconnected") return { kind: "none" };
  if (summary.state === "broken") return { kind: "broken" };
  // Connected: surface the countdown only when there's an expiry to count down.
  const expiresAt = summary.token_expires_at;
  if (!expiresAt) return { kind: "none" };
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return { kind: "none" };
  const remaining = expiresMs - nowMs;
  if (remaining <= 0) return { kind: "expired" };
  const daysRemaining = Math.ceil(remaining / DAY_MS);
  if (remaining <= EXPIRING_WITHIN_MS) return { kind: "expiring", daysRemaining };
  return { kind: "ok", daysRemaining };
}

// The token-free view the Settings UI and the Marketing page render. Pass
// testingMode (from isGoogleOAuthTestingMode()) to populate token_expires_at;
// it stays null in Production, so the countdown auto-hides once published.
export function toConnectionSummary(
  row: GoogleConnectionRow | null,
  opts: { testingMode?: boolean } = {},
): GoogleConnectionSummary {
  if (!row) {
    return {
      state: "disconnected",
      account_email: null,
      account_name: null,
      scopes: [],
      broken_reason: null,
      connected_at: null,
      token_expires_at: null,
    };
  }
  return {
    state: deriveConnectionState(row),
    account_email: row.google_account_email,
    account_name: row.google_account_name,
    scopes: row.scopes,
    broken_reason: row.broken_reason,
    connected_at: row.created_at,
    token_expires_at: refreshTokenExpiresAt(row.last_consented_at, {
      testingMode: opts.testingMode ?? false,
    }),
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

// Every Organization with a usable (connected, not broken) Google connection.
// The scheduled-sync orchestrator fans out over these: a broken connection
// can't fetch reviews, so it is skipped until the owner reconnects. Pass a
// PRIVILEGED db — the cron has no user session, and this reads across orgs.
export async function listConnectedOrganizationIds(
  db: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await db
    .from("google_connection")
    .select("organization_id")
    .eq("status", "connected");
  if (error) {
    throw new Error(`google_connection list failed: ${error.message}`);
  }
  return (data ?? []).map(
    (r) => (r as { organization_id: string }).organization_id,
  );
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
