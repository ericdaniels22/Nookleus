// Pure recipient-address validation behind the To/Cc/Bcc chips (issue #659).
//
// Today the compose chips are accepted on a bare `input.includes("@")` check,
// so `foo@` and `a b@c` slip through as "recipients" (finding L14). This is the
// one I/O-free decision that gates whether typed text becomes a chip, unit-
// tested in isolation exactly as `selectableContacts` is.

/**
 * Whether a typed string is a syntactically valid recipient email address.
 *
 * Pragmatic, not full RFC 5322: surrounding whitespace is ignored, then the
 * value must be `local@domain.tld` — a single `@`, no interior whitespace, a
 * non-empty local part, and a domain that contains a dot with non-empty labels
 * on both sides. This rejects the chips the old `.includes("@")` check let
 * through (`foo@`, `a b@c`) as well as dotless domains (`a@b`).
 */
export function isValidRecipientEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
