// Pure logic behind the inline "+ Add contact" affordance on the Call
// Worksheet (PRD #249, issue #255). Modelled after `referral-partner-form.ts`
// from issue #250 — one validity guard, one insert-payload builder, both
// I/O-free so they can be exhaustively unit-tested without React or Supabase.
//
// The inline-create button's *visibility* reuses `shouldOfferCreate` from
// `src/lib/insurance-picker.ts` (PRD #47) — no parallel helper. See the
// Worksheet component for that wiring.

/** Raw user input from the inline + Add contact form on the Worksheet —
 *  every optional field is empty-string-or-content, never undefined, so the
 *  React form can bind directly without controlled/uncontrolled gymnastics. */
export interface NewReferralContactInput {
  full_name: string;
  phone: string;
  email: string;
  notes: string;
}

/** The insert-ready shape for a new `contacts` row representing a Referral
 *  Contact. `role` is pinned to `'referral_contact'` and the row carries the
 *  current Referral Partner's id; optional fields are null (not empty string)
 *  to match how every other nullable text column behaves. */
export interface NewReferralContactPayload {
  organization_id: string;
  referral_partner_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  role: "referral_contact";
}

/**
 * Whether the inline + Add contact form is saveable. Only `full_name` is
 * required; phone, email, and notes are all optional.
 */
export function isValidNewReferralContact(
  input: NewReferralContactInput,
): boolean {
  return input.full_name.trim().length > 0;
}

/**
 * Build the row payload for inserting a Referral Contact. `role` is always
 * `'referral_contact'` and `referral_partner_id` is set to the partner the
 * Worksheet is open on. Trims `full_name`; trims every other text field and
 * collapses to null when blank.
 */
export function buildNewReferralContactPayload(
  input: NewReferralContactInput,
  organizationId: string,
  referralPartnerId: string,
): NewReferralContactPayload {
  const nullable = (s: string): string | null => {
    const trimmed = s.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  return {
    organization_id: organizationId,
    referral_partner_id: referralPartnerId,
    full_name: input.full_name.trim(),
    phone: nullable(input.phone),
    email: nullable(input.email),
    notes: nullable(input.notes),
    role: "referral_contact",
  };
}
