// `withRequestContext` — the one wrapper every authenticated API endpoint
// routes through. An endpoint no longer *starts with* a check; it *hands
// itself to* this wrapper together with a one-line rule. The wrapper runs
// the check first, and on denial sends the rejection so the endpoint's own
// code never runs — the "stop on denial" step is structural, not a line of
// code anyone can forget.
//
// It performs all the I/O the old route gates each hand-rolled: resolve the
// user, resolve the Active Organization from the JWT claim, fetch the
// caller's membership role and permission grants. The allow/deny *policy*
// itself lives in the pure `evaluatePermissionRule`.
//
// See CONTEXT.md for Organization / Active Organization / Request Context /
// User client / Service client.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { resolveCaller } from "./resolve-caller";
import {
  evaluatePermissionRule,
  type PermissionRule,
} from "./evaluate-permission-rule";

// The rule handed to the wrapper: the access-control policy plus the one
// piece of plumbing the policy does not care about — whether the Request
// Context should also carry the Service client.
//
//   { permission: "view_invoices" }                  needs that permission
//   { permission: ["view_estimates", "view_invoices"] }  needs any one
//   { adminOnly: true }                               admin role required
//   {} / omitted                                      logged-in only
//   { serviceClient: true }                           combinable with any
export interface RequestContextRule extends PermissionRule {
  serviceClient?: boolean;
}

// Handed to the route handler once the rule has passed. `supabase` is the
// User client (row-level security enforced — the database itself prevents
// cross-Organization reads). `serviceClient` is present only when the rule
// opted in. `orgId` / `role` are null only for a logged-in-only (`{}`) rule
// whose caller has no membership in the Active Organization; any rule that
// names a permission or admin guarantees both are non-null on success.
export interface RequestContext {
  userId: string;
  orgId: string | null;
  role: string | null;
  // The permission keys the wrapper already resolved for this caller —
  // empty when the caller has no membership in the Active Organization.
  // Carried through so a handler that delegates to an access-decision
  // module (#139) does not re-query the grants the wrapper already loaded.
  grantedPermissions: string[];
  supabase: SupabaseClient;
  serviceClient?: SupabaseClient;
}

type RouteSegmentContext<TParams> = { params: Promise<TParams> };

// A route handler written against this module: it receives the request, the
// resolved Request Context, and the Next.js route-segment context (dynamic
// `params`) passed through untouched.
export type ContextualRouteHandler<TParams> = (
  request: Request,
  context: RequestContext,
  routeContext: RouteSegmentContext<TParams>,
) => Promise<Response> | Response;

const REJECT_UNAUTHENTICATED = { error: "Not authenticated" };
const REJECT_FORBIDDEN = { error: "Permission denied" };

/**
 * Wraps an API route handler with authentication, Active-Organization
 * resolution, and a permission check.
 *
 * On an unauthenticated request the wrapper returns 401 and the handler
 * never runs; on a request that fails the rule it returns 403 and the
 * handler never runs. Otherwise the handler is invoked with a Request
 * Context and the Next.js route params untouched.
 *
 * `TParams` is inferred from the handler's third argument — annotate it
 * (`{ params }: { params: Promise<{ id: string }> }`) on dynamic routes.
 */
export function withRequestContext<TParams = Record<string, never>>(
  rule: RequestContextRule,
  handler: ContextualRouteHandler<TParams>,
): (
  request: Request,
  routeContext: RouteSegmentContext<TParams>,
) => Promise<Response> {
  return async (request, routeContext) => {
    const supabase = await createServerSupabaseClient();

    const caller = await resolveCaller(supabase);
    if (!caller) {
      return NextResponse.json(REJECT_UNAUTHENTICATED, { status: 401 });
    }

    if (!evaluatePermissionRule(rule, caller)) {
      return NextResponse.json(REJECT_FORBIDDEN, { status: 403 });
    }

    const context: RequestContext = {
      userId: caller.userId,
      orgId: caller.orgId,
      role: caller.role,
      grantedPermissions: caller.grantedPermissions,
      supabase,
    };
    if (rule.serviceClient) {
      context.serviceClient = createServiceClient();
    }

    return handler(request, context, routeContext);
  };
}
