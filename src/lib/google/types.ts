// DB row shape + public types for the per-Organization Google connection.
// See supabase/migration-615-google-connection.sql for the table.

// The persisted status. 'broken' is the remotely-revoked / refresh-failed
// state; 'connected' is usable. "Disconnected" is never a status — it is the
// absence of a row (disconnect deletes it), modelled by GoogleConnectionState.
export type GoogleConnectionStatus = "connected" | "broken";

// What the rest of the app reasons about: the persisted statuses plus the
// no-row case. deriveConnectionState() maps a row (or null) onto this.
export type GoogleConnectionState =
  | "disconnected"
  | "connected"
  | "broken";

export interface GoogleConnectionRow {
  id: string;
  organization_id: string;
  google_account_email: string | null;
  google_account_name: string | null;
  refresh_token_encrypted: string;
  access_token_encrypted: string | null;
  access_token_expires_at: string | null;
  scopes: string[];
  status: GoogleConnectionStatus;
  broken_reason: string | null;
  broken_at: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
}

// The connection as the Settings UI sees it — never any token material.
export interface GoogleConnectionSummary {
  state: GoogleConnectionState;
  account_email: string | null;
  account_name: string | null;
  scopes: string[];
  broken_reason: string | null;
  connected_at: string | null;
}
