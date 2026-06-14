// Pure logic behind the To-row contact picker (PRD #634, issue #640).
//
// One I/O-free helper, unit-tested in isolation exactly as the
// insurance-company picker is (src/lib/insurance-picker.ts): given the
// contacts the search source returned and the recipients already on the
// field, it decides which contacts are still pickable. No fetch, no React —
// just the decision.

/**
 * The contacts a user may still pick from a search result, given who is
 * already on the recipient field. A contact whose email already appears in
 * `alreadyAdded` is dropped, so the picker never offers to add a duplicate.
 *
 * Generic over the contact shape so the caller keeps its own extra fields
 * (display name, etc.); only `email` is read.
 */
export function selectableContacts<T extends { email: string }>(
  fetched: T[],
  alreadyAdded: { email: string }[],
): T[] {
  const added = new Set(alreadyAdded.map((r) => r.email.toLowerCase()));
  return fetched.filter((c) => !added.has(c.email.toLowerCase()));
}
