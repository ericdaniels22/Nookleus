// DB row shape + public types for the per-Organization Website connection.
// See supabase/migration-612-website-connection.sql for the table.
//
// "Website connection" is the domain concept (CONTEXT.md): an Organization's
// credentialed link to its own marketing website, which Showcase publishing
// writes posts onto. WordPress-only at first — `provider` records which
// platform a row links to, defaulting to 'wordpress'.

// The platform a connection links to. WordPress is the only provider today;
// the column exists so the concept stays provider-named, not WordPress-bound.
export type WebsiteProvider = "wordpress";

// The persisted status. 'broken' is the credential-rejected state (the
// Application Password was revoked or changed on the WordPress side, or the
// user lost publish rights); 'connected' is usable. "Disconnected" is never a
// status — it is the absence of a row (disconnect deletes it), modelled by
// WebsiteConnectionState.
export type WebsiteConnectionStatus = "connected" | "broken";

// What the rest of the app reasons about: the persisted statuses plus the
// no-row case. deriveConnectionState() maps a row (or null) onto this.
export type WebsiteConnectionState = "disconnected" | "connected" | "broken";

export interface WebsiteConnectionRow {
  id: string;
  organization_id: string;
  provider: WebsiteProvider;
  // The public site, normalised at connect time (scheme, no trailing slash).
  // Display ("Connected to example.com") and the base for every REST call.
  site_url: string;
  // The WordPress username — display, and half of the Basic-auth credential.
  username: string;
  // The WordPress Application Password — the only secret. AES-256-GCM via
  // src/lib/encryption.ts (same ENCRYPTION_KEY as the Google / QB / email
  // connections). Never leaves the lib layer.
  application_password_encrypted: string;
  // The connected account's display name (from /users/me), for the card.
  account_name: string | null;
  // 'connected' — usable.
  // 'broken'    — the credential was rejected (revoked/changed on WordPress, or
  //               publish rights lost); the UI shows a reconnect prompt. Set
  //               only on a 401, never on a transient network error.
  status: WebsiteConnectionStatus;
  broken_reason: string | null;
  broken_at: string | null;
  // Who clicked Connect. SET NULL so the row survives that user being removed.
  connected_by: string | null;
  created_at: string;
  updated_at: string;
}

// The connection as the Settings UI sees it — never the Application Password.
export interface WebsiteConnectionSummary {
  state: WebsiteConnectionState;
  provider: WebsiteProvider | null;
  site_url: string | null;
  username: string | null;
  account_name: string | null;
  broken_reason: string | null;
  connected_at: string | null;
}
