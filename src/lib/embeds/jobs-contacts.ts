// PostgREST embed strings for `jobs` → `contacts` reads.
//
// Background. Migration 193 added `jobs.insurance_contact_id` alongside the
// existing `jobs.contact_id`. PostgREST then sees two foreign keys from
// `jobs` to `contacts` and refuses an implicit `contacts(*)` embed with
// `PGRST201` ("more than one relationship was found"). Every embed must
// pick its FK explicitly, e.g. `contacts!contact_id(*)`.
//
// Centralising the embed strings here gives the integration harness (#283)
// a single point of attachment: tests import the same constant the routes
// use, so reverting one is the same as reverting the other.
//
// If a third FK from `jobs` to `contacts` is ever added, every embed
// targeting `contacts` from a `jobs` row needs to re-pick its FK — start
// here.

/** Job + the homeowner contact. Surfaces:
 *  - src/app/estimates/[id]/edit/page.tsx
 *  - src/app/estimates/[id]/page.tsx
 *  - src/app/invoices/[id]/edit/page.tsx
 */
export const JOB_WITH_HOMEOWNER_EMBED =
  "*, contact:contacts!contact_id(*)" as const;

/** Estimates-trash listing with nested job → homeowner. Surface:
 *  - src/app/api/estimates/trash/route.ts
 */
export const ESTIMATE_TRASH_WITH_JOB_HOMEOWNER_EMBED =
  "*, job:jobs!job_id(job_number, contact_id, contact:contacts!contact_id(*))" as const;

/** Invoices-trash listing with nested job → homeowner. Surface:
 *  - src/app/api/invoices/trash/route.ts
 *
 *  String matches the estimates form — kept as a distinct constant so
 *  each surface can evolve independently. (If they diverge, that is
 *  fine; the integration tests assert each surface against its own
 *  constant.) */
export const INVOICE_TRASH_WITH_JOB_HOMEOWNER_EMBED =
  "*, job:jobs!job_id(job_number, contact_id, contact:contacts!contact_id(*))" as const;

/** Jarvis `get_job_context`: job + homeowner + adjusters (with their
 *  contact rows). Surface:
 *  - src/app/api/jarvis/field-ops/route.ts
 *
 *  Two embeds against `contacts` — both pin via `!contact_id`. */
export const JARVIS_JOB_CONTEXT_EMBED =
  "*, contact:contacts!contact_id(*), job_adjusters(*, adjuster:contacts!contact_id(*))" as const;
