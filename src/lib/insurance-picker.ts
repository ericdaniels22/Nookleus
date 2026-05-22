// Pure logic behind the insurance-company picker (PRD #47, issue #194).
//
// Two I/O-free helpers, unit-tested in isolation exactly as the masked
// date field is (src/lib/date-field.ts): a create-affordance guard that
// decides whether the picker offers "+ New insurance company", and a
// claims-email validator. No Supabase, no React — just decisions.

/**
 * Whether the picker should offer the "+ New insurance company" action.
 *
 * True only when the user has typed a non-empty query AND no existing
 * insurance company matches it by exact, case-insensitive name. A
 * near-but-not-exact match (the typed text is a substring of a company's
 * name) still offers "+ New" — the user may genuinely want a new company.
 * An exact match withholds it, so loose duplicates are never created.
 *
 * @param query         the raw text typed into the picker's search box
 * @param existingNames names of the insurance companies currently on file
 */
export function shouldOfferCreate(
  query: string,
  existingNames: string[],
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  const target = trimmed.toLowerCase();
  return !existingNames.some((name) => name.trim().toLowerCase() === target);
}

// A pragmatic single-line email shape: a local part, an "@", and a
// dotted domain, none containing whitespace or a second "@".
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether a claims email is acceptable to save. The claims email is
 * optional, so an empty (or whitespace-only) string is valid — it means
 * "no claims email on file". A non-empty string must be well-formed.
 */
export function isValidClaimsEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return true;
  return EMAIL_PATTERN.test(trimmed);
}
