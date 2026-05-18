// The shared caller-resolution step behind both `withRequestContext` (API
// route handlers) and `requirePagePermission` (page Server Components).
// Given a User client it answers "who is this caller, and what can they do
// in their Active Organization" — the I/O half. The allow/deny *policy*
// itself stays in the pure `evaluatePermissionRule`.
//
// See CONTEXT.md for Organization / Active Organization / Request Context /
// User client.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import type { PermissionFacts } from "./evaluate-permission-rule";

// The caller as resolved from the Active Organization. Extends the pure
// policy's `PermissionFacts` (role + grantedPermissions) with identity
// (`userId`) and the resolved org id, so a single resolve call feeds both
// `evaluatePermissionRule` and the Request Context handed onward.
export interface ResolvedCaller extends PermissionFacts {
  userId: string;
  orgId: string | null;
}

/**
 * Resolves the authenticated caller from a User client: the user, the
 * Active Organization from the JWT claim, the membership role and the
 * granted permission keys.
 *
 * Returns `null` when the request is unauthenticated — the one case every
 * caller must branch on before a rule check is even meaningful. A caller
 * with no membership in the Active Organization resolves with `role: null`
 * and `grantedPermissions: []`.
 */
export async function resolveCaller(
  supabase: SupabaseClient,
): Promise<ResolvedCaller | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const orgId = await getActiveOrganizationId(supabase);

  const { data: membership } = await supabase
    .from("user_organizations")
    .select("id, role")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle<{ id: string; role: string }>();

  let grantedPermissions: string[] = [];
  if (membership) {
    const { data: grants } = await supabase
      .from("user_organization_permissions")
      .select("permission_key")
      .eq("user_organization_id", membership.id)
      .eq("granted", true);
    grantedPermissions = ((grants ?? []) as { permission_key: string }[]).map(
      (g) => g.permission_key,
    );
  }

  return {
    userId: user.id,
    orgId,
    role: membership?.role ?? null,
    grantedPermissions,
  };
}
