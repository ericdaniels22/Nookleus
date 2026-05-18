// `requirePagePermission` — the page Server Component counterpart to
// `withRequestContext`. A page cannot be *wrapped* (it is rendered, not
// invoked as a route handler), so instead of handing the page to a wrapper
// it calls this and branches on the result: on `ok: false` it renders its
// own access-denied UI; on `ok: true` it proceeds with the resolved caller.
//
// It shares the caller-resolution (`resolveCaller`) and the access policy
// (`evaluatePermissionRule`) with `withRequestContext`, so a page and an
// API route enforce the *same* rule the same way.
//
// See CONTEXT.md for Organization / Active Organization / Request Context.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCaller } from "./resolve-caller";
import {
  evaluatePermissionRule,
  type PermissionRule,
} from "./evaluate-permission-rule";

// The result a page branches on. On success it carries the same identity
// fields a Request Context would (`userId` / `orgId` / `role`); on failure
// it carries nothing — a page renders one access-denied UI for both the
// unauthenticated and the forbidden case.
export type PagePermissionResult =
  | { ok: true; userId: string; orgId: string | null; role: string | null }
  | { ok: false };

/**
 * Checks a page Server Component's caller against a permission rule.
 *
 * Returns `{ ok: false }` when the caller is unauthenticated OR fails the
 * rule; the page should render its access-denied UI and read no data.
 * Returns `{ ok: true, ... }` carrying the resolved caller otherwise.
 *
 * `rule` is the same `PermissionRule` shape `withRequestContext` takes
 * (minus the route-only `serviceClient` flag): `{ permission: "key" }`,
 * `{ permission: [...] }`, `{ adminOnly: true }`, `{ roles: [...] }`, `{}`.
 * The page passes its own already-created User client.
 */
export async function requirePagePermission(
  supabase: SupabaseClient,
  rule: PermissionRule,
): Promise<PagePermissionResult> {
  const caller = await resolveCaller(supabase);
  if (!caller) return { ok: false };
  if (!evaluatePermissionRule(rule, caller)) return { ok: false };
  return {
    ok: true,
    userId: caller.userId,
    orgId: caller.orgId,
    role: caller.role,
  };
}
