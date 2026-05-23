// The access-decision module for Email accounts. Pure functions: no I/O,
// no Supabase, no HTTP. Given a caller and an Email account (existing or
// proposed), they answer the four questions every email-area route needs:
//
//   canSee    — does the account appear in the caller's UI?
//   canRead   — can the caller open its mail?
//   canManage — can the caller edit its settings or disconnect it?
//   canCreate — may the caller create an account of this kind / owner?
//
// The first three are returned together by `evaluateEmailAccountAccess`;
// the fourth is returned by `canCreateEmailAccount`. The matrix is fixed
// by ADR 0001 (Shared and Personal email accounts) and varies by account
// kind and the caller's role and permissions within the account's
// Organization; cross-Organization callers get denied on every account,
// regardless of permissions — the same 404-equivalent convention as
// #98/#101/#119.
//
// This module is the single source of truth for the matrix. Routes
// delegate to it rather than re-implementing the rule.
//
// An unknown account kind throws, never quietly returns false — same
// posture as the #97 resolver registry: an unregistered case is a
// programming error, not a silent deny.

export type EmailAccountKind = "shared" | "personal";

// The fields of an Email account this module needs. A Shared account has
// `userId === null`; a Personal account has `userId === <owner>`.
export interface EmailAccount {
  kind: EmailAccountKind;
  organizationId: string;
  userId: string | null;
}

// What the caller is, as resolved from the Active Organization the
// request came in on. `role` is null when the caller has no membership
// in their Active Organization; `grantedPermissions` is then empty.
export interface EmailAccountCaller {
  userId: string;
  organizationId: string;
  role: string | null;
  grantedPermissions: string[];
}

export interface EmailAccountAccess {
  canSee: boolean;
  canRead: boolean;
  canManage: boolean;
}

const DENY: EmailAccountAccess = {
  canSee: false,
  canRead: false,
  canManage: false,
};

// One evaluator per account kind. The caller is already known to be in
// the account's Organization when an evaluator runs — the cross-org
// short-circuit lives in `evaluateEmailAccountAccess` so each evaluator
// only deals with the in-org branches of the matrix.
type Evaluator = (
  caller: EmailAccountCaller,
  account: EmailAccount,
) => EmailAccountAccess;

const evaluateSharedAccess: Evaluator = (caller) => {
  const isAdmin = caller.role === "admin";
  const hasViewEmail =
    isAdmin || caller.grantedPermissions.includes("view_email");
  return {
    canSee: hasViewEmail,
    canRead: hasViewEmail,
    canManage: isAdmin,
  };
};

const evaluatePersonalAccess: Evaluator = (caller, account) => {
  if (account.userId === caller.userId) {
    return { canSee: true, canRead: true, canManage: true };
  }
  if (caller.role === "admin") {
    // Content-private: an admin can see + disconnect a Personal account
    // they do not own, but cannot read its mail. See ADR 0001.
    return { canSee: true, canRead: false, canManage: true };
  }
  return DENY;
};

// Every account kind the module knows how to evaluate, and how. A kind
// absent from this map is a deliberate gap: `evaluateEmailAccountAccess`
// throws, so adding a kind is a conscious act of registering it here
// (along with its row in the ADR's matrix).
const EVALUATORS: Record<EmailAccountKind, Evaluator> = {
  shared: evaluateSharedAccess,
  personal: evaluatePersonalAccess,
};

/**
 * Decides, for a (caller, Email account) pair, whether the caller can
 * see, read, and manage the account.
 *
 * Cross-Organization callers get all-false on every account, regardless
 * of role or permission grants. An unknown account kind throws — an
 * unrecognized kind is a programming error, never a quiet allow or deny.
 */
export function evaluateEmailAccountAccess(
  caller: EmailAccountCaller,
  account: EmailAccount,
): EmailAccountAccess {
  if (caller.organizationId !== account.organizationId) {
    return DENY;
  }
  const evaluator = EVALUATORS[account.kind];
  if (!evaluator) {
    throw new Error(
      `evaluateEmailAccountAccess: unknown email account kind "${account.kind}"`,
    );
  }
  return evaluator(caller, account);
}

// One create-evaluator per account kind. Mirrors EVALUATORS above: each
// evaluator only deals with the in-org branches of the create matrix, and
// canCreateEmailAccount handles the cross-Organization short-circuit at the
// top.
type CreateEvaluator = (
  caller: EmailAccountCaller,
  proposed: EmailAccount,
) => boolean;

const canCreateShared: CreateEvaluator = (caller) => caller.role === "admin";

const canCreatePersonal: CreateEvaluator = (caller, proposed) => {
  if (caller.role === "admin") return true;
  return proposed.userId === caller.userId;
};

const CREATE_EVALUATORS: Record<EmailAccountKind, CreateEvaluator> = {
  shared: canCreateShared,
  personal: canCreatePersonal,
};

/**
 * Decides whether a caller may create an Email account of a given kind for a
 * proposed owner. See ADR 0001: the access matrix is captured once, in this
 * module; every route delegates. This function is the create branch of that
 * matrix.
 */
export function canCreateEmailAccount(
  caller: EmailAccountCaller,
  proposed: EmailAccount,
): boolean {
  if (caller.organizationId !== proposed.organizationId) {
    return false;
  }
  // Belt-and-suspenders: the email-area route wrapper gates send_email at
  // the door, but a future caller (CLI, server action, script) might wire
  // this function in without that wrapper. Re-check here so the answer is
  // safe regardless of how we're called.
  if (!caller.grantedPermissions.includes("send_email")) {
    return false;
  }
  const evaluator = CREATE_EVALUATORS[proposed.kind];
  if (!evaluator) {
    throw new Error(
      `canCreateEmailAccount: unknown email account kind "${proposed.kind}"`,
    );
  }
  return evaluator(caller, proposed);
}
