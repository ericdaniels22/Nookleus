// The Website connection store: deriving its public state from a row, and the
// org-scoped reads/writes the routes and Showcase publishing lean on.
//
// Org scoping is EXPLICIT here — every DB function takes an organizationId and
// filters on it. The Marketing Suite is multi-tenant from day one (PRD #603),
// so a connection is only ever read or mutated within a named Organization.

import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "../encryption";
import type {
  WebsiteConnectionRow,
  WebsiteConnectionState,
  WebsiteConnectionSummary,
  WebsiteProvider,
} from "./types";

// A row (or its absence) maps onto exactly one state. No row means
// disconnected — disconnect deletes the row, so absence IS the state.
export function deriveConnectionState(
  row: WebsiteConnectionRow | null,
): WebsiteConnectionState {
  if (!row) return "disconnected";
  return row.status === "broken" ? "broken" : "connected";
}

// The credential-free view the Settings card renders. The Application Password
// is deliberately absent — it never leaves the lib layer.
export function toConnectionSummary(
  row: WebsiteConnectionRow | null,
): WebsiteConnectionSummary {
  if (!row) {
    return {
      state: "disconnected",
      provider: null,
      site_url: null,
      username: null,
      account_name: null,
      broken_reason: null,
      connected_at: null,
    };
  }
  return {
    state: deriveConnectionState(row),
    provider: row.provider,
    site_url: row.site_url,
    username: row.username,
    account_name: row.account_name,
    broken_reason: row.broken_reason,
    connected_at: row.created_at,
  };
}

// The Organization's single connection, or null. Org-scoped (see header).
export async function getWebsiteConnection(
  db: SupabaseClient,
  organizationId: string,
): Promise<WebsiteConnectionRow | null> {
  const { data } = await db
    .from("website_connection")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle<WebsiteConnectionRow>();
  return data ?? null;
}

// Flip a connection to the broken state. Called when a publish (or a re-check)
// is rejected with a 401 — the Application Password was revoked or changed on
// WordPress, or the user lost publish rights. Never called on a transient
// error. The UI reads 'broken' as "show the reconnect prompt".
export async function markBroken(
  db: SupabaseClient,
  connectionId: string,
  reason: string,
): Promise<void> {
  const { error } = await db
    .from("website_connection")
    .update({
      status: "broken",
      broken_reason: reason,
      broken_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
  // A failed flip is worth a loud line: the row stays 'connected' while publish
  // keeps failing, so the UI won't show the reconnect prompt. Don't let that
  // fail silently.
  if (error) {
    console.error(
      `[website] FAILED to mark connection ${connectionId} broken (${reason}): ${error.message}`,
    );
    return;
  }
  console.warn(`[website] connection ${connectionId} marked broken: ${reason}`);
}

// The plaintext credential + metadata the connect route hands the store. The
// Application Password is plaintext HERE and nowhere else above the lib layer —
// upsertConnection encrypts it before it touches the database.
export interface UpsertConnectionParams {
  organizationId: string;
  provider: WebsiteProvider;
  siteUrl: string;
  username: string;
  applicationPassword: string;
  accountName: string | null;
  connectedBy: string;
}

// Persist (or replace) the Organization's single connection. The deep boundary
// for the credential: the plaintext Application Password enters here and is
// AES-256-GCM encrypted before the upsert — it is never written in the clear and
// never leaves this layer. One row per org (onConflict organization_id), so a
// reconnect overwrites the prior row in place and clears any broken state.
export async function upsertConnection(
  db: SupabaseClient,
  params: UpsertConnectionParams,
): Promise<{ error: string | null }> {
  const { error } = await db.from("website_connection").upsert(
    {
      organization_id: params.organizationId,
      provider: params.provider,
      site_url: params.siteUrl,
      username: params.username,
      application_password_encrypted: encrypt(params.applicationPassword),
      account_name: params.accountName,
      status: "connected",
      broken_reason: null,
      broken_at: null,
      connected_by: params.connectedBy,
    },
    { onConflict: "organization_id" },
  );
  if (error) {
    console.error(
      `[website] FAILED to upsert connection for org ${params.organizationId}: ${error.message}`,
    );
    return { error: error.message };
  }
  return { error: null };
}

// Remove the Organization's connection entirely. Disconnect deletes rather than
// retains: the stored Application Password never lingers locally after the user
// disconnects (the user revokes it on WordPress separately).
export async function deleteConnection(
  db: SupabaseClient,
  organizationId: string,
): Promise<void> {
  const { error } = await db
    .from("website_connection")
    .delete()
    .eq("organization_id", organizationId);
  if (error) {
    console.error(
      `[website] FAILED to delete connection for org ${organizationId}: ${error.message}`,
    );
  }
}
