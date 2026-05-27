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
