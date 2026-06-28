// The deep module: the ONE place the rest of the app gets an authorized Google
// client for an Organization. Callers ask getGoogleClient(db, orgId) and receive
// an object that makes authorized requests; they never see refresh tokens,
// access tokens, expiries, or scopes. This is the "deep interface that hides
// tokens, refresh, and scopes entirely" #615 requires.
//
// getValidGoogleAccessToken is the token chokepoint (qb's getValidAccessToken
// equivalent): it returns the cached access token while fresh, refreshes it
// transparently when stale, and — crucially — flips the connection to broken
// ONLY when the refresh token is revoked/expired (invalid_grant). A transient
// failure rethrows so a momentary Google outage never looks like a disconnect.
//
// PASS A PRIVILEGED `db`. This module WRITES (persisting a refreshed token,
// flipping to broken), and google_connection's RLS is admin-only. A non-admin
// User client would let those writes silently affect zero rows — the refresh
// wouldn't persist and a broken-flip wouldn't stick. Consumers (cron jobs, the
// later marketing slices) should hand in the Service client, or a client whose
// caller is an admin of this Organization.

import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/encryption";
import { getGoogleConnection, markBroken } from "./connection";
import { refreshAccessToken, isRevokedError } from "./oauth";
import { getGoogleOAuthConfig, type GoogleOAuthConfig } from "./config";
import type { GoogleConnectionRow } from "./types";

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

// Pure: should the cached access token be refreshed before use? A missing or
// unparseable expiry means "yes" (treat as no usable cache); otherwise refresh
// once it falls inside the threshold so callers never hold a token that expires
// mid-request.
export function shouldRefreshAccessToken(
  expiresAtIso: string | null,
  nowMs: number,
  thresholdMs: number = REFRESH_THRESHOLD_MS,
): boolean {
  if (!expiresAtIso) return true;
  const expires = Date.parse(expiresAtIso);
  if (Number.isNaN(expires)) return true;
  return expires - nowMs <= thresholdMs;
}

interface ClientDeps {
  config?: GoogleOAuthConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface ValidGoogleToken {
  accessToken: string;
  connection: GoogleConnectionRow;
}

export async function getValidGoogleAccessToken(
  db: SupabaseClient,
  organizationId: string,
  deps: ClientDeps = {},
): Promise<ValidGoogleToken | null> {
  const conn = await getGoogleConnection(db, organizationId);
  if (!conn || conn.status === "broken") return null;

  const nowMs = (deps.now ?? Date.now)();

  if (
    conn.access_token_encrypted &&
    !shouldRefreshAccessToken(conn.access_token_expires_at, nowMs)
  ) {
    return { accessToken: decrypt(conn.access_token_encrypted), connection: conn };
  }

  const config = deps.config ?? getGoogleOAuthConfig();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const refreshToken = decrypt(conn.refresh_token_encrypted);
  try {
    const refreshed = await refreshAccessToken(refreshToken, { config, fetchImpl });
    const access_token_expires_at = new Date(
      nowMs + refreshed.expiresIn * 1000,
    ).toISOString();
    const { error: persistErr } = await db
      .from("google_connection")
      .update({
        access_token_encrypted: encrypt(refreshed.accessToken),
        access_token_expires_at,
      })
      .eq("id", conn.id);
    // Not fatal — we still hand back the fresh token — but a failed write means
    // the next call refreshes again (often a sign db isn't privileged; see the
    // "PASS A PRIVILEGED db" note above). Surface it rather than swallow it.
    if (persistErr) {
      console.error(
        `[google] failed to persist refreshed access token for org ${organizationId}: ${persistErr.message}`,
      );
    }
    return {
      accessToken: refreshed.accessToken,
      connection: { ...conn, access_token_expires_at },
    };
  } catch (err) {
    if (isRevokedError(err)) {
      await markBroken(db, conn.id, "invalid_grant");
      return null;
    }
    throw err; // transient — surface it; the connection stays connected.
  }
}

// The authorized client handed to feature code. `fetch` injects a valid bearer
// token on every call; `getAccessToken` is the escape hatch for a caller that
// must hand the token to another library. Neither exposes the refresh token.
export interface GoogleClient {
  organizationId: string;
  accountEmail: string | null;
  getAccessToken(): string;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export async function getGoogleClient(
  db: SupabaseClient,
  organizationId: string,
  deps: ClientDeps = {},
): Promise<GoogleClient | null> {
  const token = await getValidGoogleAccessToken(db, organizationId, deps);
  if (!token) return null;

  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    organizationId,
    accountEmail: token.connection.google_account_email,
    getAccessToken: () => token.accessToken,
    fetch(input, init) {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token.accessToken}`);
      return fetchImpl(input, { ...init, headers });
    },
  };
}
