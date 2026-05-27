// PRD #304 — Nookleus Phone. The access-decision module for phone numbers
// and (in future slices) phone events. Pure functions: no I/O, no Supabase,
// no HTTP. ADR 0003 fixes the access matrix.
//
// Slice 3 (#307) lands the manage-only branch: who can provision and
// release phone numbers. The read-path matrix (`canRead` / `canSendFrom`
// for messages and calls) lands with slice 4+; the module file already
// exists here so those slices extend it rather than introduce a new one.
//
// Manage rule (ADR 0003):
//   Shared    — admin-only (matches ADR 0001's email-Shared pattern).
//   Personal  — owner OR admin (admin manages for offboarding per ADR 0003,
//               even though Personal numbers don't land until slice 13).
//
// Cross-Organization callers get all-false on every number, regardless of
// role — the same 404-equivalent convention as #98 / #101 / #119 and the
// existing `email-account-access` module.
//
// An unknown number kind throws, never quietly returns false — same posture
// as the email-access module: an unrecognized case is a programming error,
// not a silent deny.

export type PhoneNumberKind = "shared" | "personal";

// The fields of a `phone_numbers` row this module needs. A Shared number
// has `userId === null`; a Personal number has `userId === <owner>`.
export interface PhoneNumberForManage {
  kind: PhoneNumberKind;
  organizationId: string;
  userId: string | null;
}

// The caller, as resolved from the Active Organization the request came in
// on. `role` is null only when the caller has no membership in their
// Active Organization (the `{}` rule case); a phone-area route names a
// permission and therefore guarantees role is non-null on success.
export interface PhoneEventCaller {
  userId: string;
  organizationId: string;
  role: string | null;
}

type ManageEvaluator = (
  caller: PhoneEventCaller,
  number: PhoneNumberForManage,
) => boolean;

const canManageShared: ManageEvaluator = (caller) => caller.role === "admin";

const canManagePersonal: ManageEvaluator = (caller, number) => {
  if (caller.role === "admin") return true;
  return number.userId === caller.userId;
};

const MANAGE_EVALUATORS: Record<PhoneNumberKind, ManageEvaluator> = {
  shared: canManageShared,
  personal: canManagePersonal,
};

/**
 * Decides whether a caller may manage (provision / update / release) a
 * given phone number. Cross-Organization callers get false on every
 * number, regardless of role. An unknown number kind throws — an
 * unrecognized kind is a programming error, never a quiet allow or deny.
 */
export function canManage(
  caller: PhoneEventCaller,
  number: PhoneNumberForManage,
): boolean {
  if (caller.organizationId !== number.organizationId) return false;
  const evaluator = MANAGE_EVALUATORS[number.kind];
  if (!evaluator) {
    throw new Error(
      `canManage: unknown phone number kind "${number.kind}"`,
    );
  }
  return evaluator(caller, number);
}

// ---------------------------------------------------------------------------
// canRead — the read-path matrix from ADR 0003. PRD #304 § Privacy rule:
//
//   Job-tagged content is team-visible to anyone with view_phone who can
//   see the Job, across all numbers (Shared or Personal).
//   Untagged content on a Shared number is team-visible.
//   Untagged content on a Personal number is owner-only — including
//   hidden from admins.
//
// Cross-org callers are denied regardless of permission. The matrix lives
// in `phone-event-access` for the Service-client paths and in mirrored
// RLS policies (migration-308) for the User-client paths; tests pin both
// stay in sync.
// ---------------------------------------------------------------------------

// The caller, with permission grants — needed for the view_phone gate that
// canManage did not have to consider. Admin role grants view_phone by
// default (matches PRD § Permission), regardless of an explicit grant
// list.
export interface PhoneEventReadCaller extends PhoneEventCaller {
  grantedPermissions: string[];
}

// The fields of a `phone_messages` / `phone_calls` row this module needs.
// `numberKind` and `numberOwnerId` are joined from `phone_numbers`; the
// caller of this module is responsible for that join (the Service-client
// route reads both rows; the RLS-policy SQL inlines the join).
export interface PhoneEventForRead {
  organizationId: string;
  numberKind: PhoneNumberKind;
  numberOwnerId: string | null; // null for Shared
  jobTag: string | null;        // null when not tagged to a Job
}

// Job visibility is supplied by the caller. Slice 4 callers use the
// default "every authenticated user can see every Job in their active
// org" policy from schema.sql; later slices can refine this (per-user
// Job ACLs).
export interface CanReadContext {
  jobVisibleToCaller: boolean;
}

type ReadEvaluator = (
  caller: PhoneEventReadCaller,
  event: PhoneEventForRead,
  context: CanReadContext,
) => boolean;

const evaluateSharedRead: ReadEvaluator = () => {
  // Untagged Shared is team-visible; tagged Shared is also team-visible
  // (the Job-tag branch only ever adds access, never removes it).
  return true;
};

const evaluatePersonalRead: ReadEvaluator = (caller, event, context) => {
  // Owner can always read their own Personal-number content.
  if (event.numberOwnerId === caller.userId) return true;
  // Non-owners can read only when the event is Job-tagged AND they can
  // see the Job. Admin role does not bypass this — content-private.
  if (event.jobTag !== null && context.jobVisibleToCaller) return true;
  return false;
};

const READ_EVALUATORS: Record<PhoneNumberKind, ReadEvaluator> = {
  shared: evaluateSharedRead,
  personal: evaluatePersonalRead,
};

/**
 * Decides whether a caller may read a phone message or call event. The
 * matrix is the ADR 0003 OR-tree: Shared-team OR Personal-owner OR
 * (Job-tagged AND Job-visible). Cross-org denied. Lack of view_phone (or
 * admin role) denied. An unknown number kind throws.
 */
export function canRead(
  caller: PhoneEventReadCaller,
  event: PhoneEventForRead,
  context: CanReadContext,
): boolean {
  if (caller.organizationId !== event.organizationId) return false;
  // view_phone gate — admin role carries it implicitly.
  const hasViewPhone =
    caller.role === "admin" || caller.grantedPermissions.includes("view_phone");
  if (!hasViewPhone) return false;
  const evaluator = READ_EVALUATORS[event.numberKind];
  if (!evaluator) {
    throw new Error(
      `canRead: unknown phone number kind "${event.numberKind}"`,
    );
  }
  return evaluator(caller, event, context);
}
