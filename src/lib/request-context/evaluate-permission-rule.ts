// The single home of the access-control policy. A pure function: no I/O,
// no Supabase, no HTTP. Given a permission rule and the facts about a
// caller, it answers one question — is this caller allowed in?
//
// It is deliberately ignorant of authentication (the 401 case) and of the
// Service-client opt-in. Those are I/O and plumbing concerns owned by
// `withRequestContext`. This module only encodes the role/permission policy
// that the four old route gates (requirePermission, requireAnyPermission,
// requireAdmin, requireViewAccounting) and the inline requireLogExpenses
// each re-implemented by hand.

// The policy half of a Request Context rule. `withRequestContext` accepts
// this plus a `serviceClient` flag; that flag never reaches this function
// because it is not a policy question.
export interface PermissionRule {
  // Caller must hold this permission key, or any one of these keys. Admins
  // always pass a `permission` rule without holding the key.
  permission?: string | string[];
  // Caller must have the `admin` role. No permission key substitutes.
  adminOnly?: boolean;
}

// What the caller is, as resolved from the active organization. `role` is
// null when the caller has no membership in the active organization;
// `grantedPermissions` is then empty.
export interface PermissionFacts {
  role: string | null;
  grantedPermissions: string[];
}

/**
 * Decides whether a caller satisfies a permission rule.
 *
 * - `adminOnly` passes only for role `admin`.
 * - `permission` (single key or array) passes if the caller is `admin` OR
 *   holds at least one of the keys.
 * - An empty rule (`{}` — logged-in only) always passes; the caller having
 *   reached this function means authentication already succeeded.
 *
 * `adminOnly` and `permission` are meant to be mutually exclusive; if both
 * are set, `adminOnly` is enforced (the stricter of the two).
 */
export function evaluatePermissionRule(
  rule: PermissionRule,
  facts: PermissionFacts,
): boolean {
  if (rule.adminOnly) {
    return facts.role === "admin";
  }

  if (rule.permission !== undefined) {
    if (facts.role === "admin") return true;
    const keys = Array.isArray(rule.permission)
      ? rule.permission
      : [rule.permission];
    return keys.some((key) => facts.grantedPermissions.includes(key));
  }

  // Empty rule: authentication alone is enough.
  return true;
}
