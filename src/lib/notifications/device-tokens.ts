// Device-address registry: the single owner of the `device_tokens` table.
//
// One row per (Org member, device): the APNs push token a member's device
// hands us, scoped to the Organization that member was acting in. Uniqueness is
// on the token itself — re-registering the same token refreshes the existing
// row (org, updated_at) instead of duplicating it. A rotated token arrives as a
// new value (a new row); the stale one is pruned once APNs reports it dead.
//
// This slice only fills the registry — no buzz is sent here. The new-intake
// dispatcher will later read it via listDeviceTokensForUsers. See
// docs/adr/0016-new-intake-push-notifications.md and issue #671.

import type { SupabaseClient } from "@supabase/supabase-js";

export type DevicePlatform = "ios";

export interface RegisterDeviceTokenInput {
  // Trusted owner of this device address — always derived from the session, never
  // from the client body (see #119).
  userId: string;
  // The Org the member was acting in when they registered.
  organizationId: string;
  // The APNs device token.
  token: string;
  platform?: DevicePlatform;
}

// The registry takes an injected client so each caller supplies the right one:
// the /api/push/register route hands it a Service client (RLS bypassed; the
// user_id is already trusted), and cross-user reads (list/prune) likewise need
// service scope.
type Client = SupabaseClient;

/**
 * Register — or refresh — the caller's device address. Idempotent on the token:
 * re-registering the same token updates the existing row rather than inserting a
 * duplicate.
 */
export async function registerDeviceToken(
  client: Client,
  input: RegisterDeviceTokenInput,
): Promise<void> {
  const { error } = await client.from("device_tokens").upsert(
    {
      user_id: input.userId,
      organization_id: input.organizationId,
      token: input.token,
      platform: input.platform ?? "ios",
    },
    { onConflict: "token" },
  );
  if (error) throw new Error(`device_tokens upsert: ${error.message}`);
}

/**
 * List the live device tokens registered to any of the given user ids. Returns a
 * flat, de-duplicated list of tokens — the address book a push fan-out targets.
 */
export async function listDeviceTokensForUsers(
  client: Client,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await client
    .from("device_tokens")
    .select("token")
    .in("user_id", userIds);
  if (error) throw new Error(`device_tokens list: ${error.message}`);
  const tokens = (data ?? []).map((r: { token: string }) => r.token);
  return [...new Set(tokens)];
}

/**
 * Prune dead device addresses — the tokens APNs reported as unregistered. A
 * no-op when given an empty list.
 */
export async function pruneDeviceTokens(
  client: Client,
  tokens: string[],
): Promise<void> {
  if (tokens.length === 0) return;
  const { error } = await client.from("device_tokens").delete().in("token", tokens);
  if (error) throw new Error(`device_tokens prune: ${error.message}`);
}
