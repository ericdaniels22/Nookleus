// src/lib/timesheets/load-org-timezone.ts — the one server-side path that turns
// an Organization id into its effective IANA timezone (#704, ADR 0020).
//
// Every server-side hour-classification path obtains its zone EXCLUSIVELY
// through this helper, so the boundary math never touches the host's
// `new Date()` local zone. It reads the Organization's `company_settings`
// key/value rows under the caller's RLS — scoped to the given org id, so a
// request in Organization A can only read A's `timezone` and `address_state`
// keys — and resolves them through the shared pure {@link
// resolveOrganizationTimezone} (same precedence the Settings UI proposes with).

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveOrganizationTimezone } from "./org-timezone";

/**
 * Read an Organization's `company_settings` rows (RLS-scoped to `organizationId`)
 * and resolve them to the effective IANA timezone. Throws on a query error; an
 * Organization with no rows resolves to the documented UTC fallback, never to
 * the host clock.
 */
export async function loadOrganizationTimezone(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("company_settings")
    .select("key, value")
    .eq("organization_id", organizationId);
  if (error) throw new Error(error.message);

  const settings: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{
    key: string;
    value: string | null;
  }>) {
    settings[row.key] = row.value ?? "";
  }

  return resolveOrganizationTimezone(settings);
}
