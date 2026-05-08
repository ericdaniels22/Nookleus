// Shared route gate that authorizes by permission key. Admins always pass.
// Mirrors the shape of requireAdmin() in src/lib/qb/auth.ts so the call site
// looks identical: `if (!gate.ok) return gate.response;`
//
// Source of truth: user_organizations.role (scoped to the active org) and
// user_organization_permissions.granted. The legacy user_permissions table
// is deprecated but still present — do not read from it here. The active
// org is sourced from the JWT claim via getActiveOrganizationId.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

export type RequirePermissionResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export async function requirePermission(
  supabase: SupabaseClient,
  key: string,
): Promise<RequirePermissionResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "not authenticated" }, { status: 401 }),
    };
  }
  const orgId = await getActiveOrganizationId(supabase);
  const { data: membership } = await supabase
    .from("user_organizations")
    .select("id, role")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle<{ id: string; role: string }>();
  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  if (membership.role === "admin") {
    return { ok: true, userId: user.id };
  }
  const { data: perm } = await supabase
    .from("user_organization_permissions")
    .select("granted")
    .eq("user_organization_id", membership.id)
    .eq("permission_key", key)
    .maybeSingle<{ granted: boolean }>();
  if (perm?.granted === true) {
    return { ok: true, userId: user.id };
  }
  return {
    ok: false,
    response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
  };
}

// Returns ok if the user has ANY of the given permission keys (admins still
// pass via the inner requirePermission). Used by item-library routes which
// allow either view_estimates or view_invoices to read.
export async function requireAnyPermission(
  supabase: SupabaseClient,
  keys: string[],
): Promise<RequirePermissionResult> {
  for (const k of keys) {
    const r = await requirePermission(supabase, k);
    if (r.ok) return r;
  }
  // All keys failed — return the last result so the caller propagates a 401/403.
  return await requirePermission(supabase, keys[keys.length - 1]);
}
