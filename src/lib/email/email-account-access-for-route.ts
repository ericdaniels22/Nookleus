// Bridge between Request Context and the pure email-account-access module.
//
// Every Service-client route that acts on a specific Email account by id
// runs the same three steps:
//   1. fetch the account row via the Service client (RLS bypassed — needed
//      so an admin can see Personal accounts they do not own);
//   2. compose a caller from the Request Context plus a row from the table;
//   3. ask `evaluateEmailAccountAccess` and map the booleans to HTTP status:
//        - canSee false   → 404 (cross-org or invisible Personal)
//        - canManage/Read → 403 (visible but action forbidden)
//
// This module owns that orchestration in one place so each route is just
// a one-line authorize-then-act, and no route invents a slightly different
// status mapping.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RequestContext } from "@/lib/request-context/with-request-context";
import {
  evaluateEmailAccountAccess,
  type EmailAccountAccess,
} from "./email-account-access";

// The slice of an `email_accounts` row needed to decide access — the rest
// of the row (credentials, label, host, etc.) is irrelevant to the matrix.
export interface EmailAccountRow {
  organization_id: string;
  user_id: string | null;
}

// The decision the route asks for. `canSee` is implicit — every route that
// touches a specific account requires at minimum that the caller can see
// it; routes additionally pick one of canRead or canManage.
export type RequiredAccess = "canRead" | "canManage";

export type EmailAccountAccessResult =
  | { kind: "ok"; account: EmailAccountRow; access: EmailAccountAccess }
  | { kind: "response"; response: Response };

/**
 * Looks up an Email account by id via the Service client and asks the
 * access module whether the caller is allowed to perform the named action
 * on it. Returns either the ok bundle (the route runs its action) or the
 * exact response to return (404 or 403, never 500 or 401 — those are the
 * wrapper's responsibility upstream).
 *
 * The Service client is required because the User-client RLS hides
 * Personal accounts the caller does not own, including from admins who
 * need to manage them.
 */
export async function resolveEmailAccountAccess(
  serviceClient: SupabaseClient,
  accountId: string,
  ctx: RequestContext,
  required: RequiredAccess,
): Promise<EmailAccountAccessResult> {
  const { data: account } = await serviceClient
    .from("email_accounts")
    .select("organization_id, user_id")
    .eq("id", accountId)
    .maybeSingle<EmailAccountRow>();

  if (!account) {
    return {
      kind: "response",
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }

  const access = evaluateEmailAccountAccess(
    {
      userId: ctx.userId,
      // `withRequestContext` guarantees a non-null `orgId` for any rule
      // that names a permission; routes that opt into this helper all do.
      // The `?? ""` keeps the type tight without a `!` non-null assertion.
      organizationId: ctx.orgId ?? "",
      role: ctx.role,
      grantedPermissions: ctx.grantedPermissions,
    },
    {
      kind: account.user_id === null ? "shared" : "personal",
      organizationId: account.organization_id,
      userId: account.user_id,
    },
  );

  if (!access.canSee) {
    return {
      kind: "response",
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }
  if (!access[required]) {
    return {
      kind: "response",
      response: NextResponse.json({ error: "Permission denied" }, { status: 403 }),
    };
  }

  return { kind: "ok", account, access };
}
