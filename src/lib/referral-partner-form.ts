// Pure logic behind the New Target form (PRD #249, issue #250).
//
// Two I/O-free helpers, unit-tested in isolation: a validity guard for the
// minimal 5-field cold-call create form, and a payload builder that
// produces the row shape ready to insert into `referral_partners`. The
// `status` field is always `'grey'` — every Target lands uncontacted; the
// Worksheet is where the lifecycle progresses. Modelled after
// `src/lib/insurance-picker.ts`.

/** Raw user input from the New Target dialog — every optional field is
 *  empty-string-or-content, never undefined, so the React form can bind
 *  directly without controlled/uncontrolled gymnastics. */
export interface NewTargetInput {
  company_name: string;
  office_phone: string;
  lead_source: string;
  industry: string;
  notes: string;
}

/** The insert-ready shape for a new row in `referral_partners`. Optional
 *  fields are null (not empty string) so the column reflects "not yet
 *  known," matching how every other nullable text column in the schema
 *  behaves. */
export interface NewTargetPayload {
  organization_id: string;
  company_name: string;
  office_phone: string | null;
  lead_source: string | null;
  industry: string | null;
  notes: string | null;
  status: "grey";
}

/**
 * Whether the New Target form's contents are saveable.
 *
 * The only requirement is a non-blank `company_name`. Every other field is
 * optional; the user may legitimately add a target with just a name they
 * intend to enrich on the call.
 */
export function isValidNewTarget(input: NewTargetInput): boolean {
  return input.company_name.trim().length > 0;
}

/**
 * Build the row payload for inserting a Target. Always pinned to `grey`
 * Lifecycle status (the cold-call list is by definition uncontacted).
 * `company_name` is trimmed; every other text field is trimmed and
 * collapsed to `null` when empty.
 */
export function buildNewTargetPayload(
  input: NewTargetInput,
  organizationId: string,
): NewTargetPayload {
  const nullable = (s: string): string | null => {
    const trimmed = s.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  return {
    organization_id: organizationId,
    company_name: input.company_name.trim(),
    office_phone: nullable(input.office_phone),
    lead_source: nullable(input.lead_source),
    industry: nullable(input.industry),
    notes: nullable(input.notes),
    status: "grey",
  };
}
