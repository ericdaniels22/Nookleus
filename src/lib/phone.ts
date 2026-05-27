// Shared US phone-number helpers (PRD #45, issue #183). The app standardizes
// on a `(xxx) xxx-xxxx` display string and a canonical E.164 storage value.

/** Digits only, with a leading US country-code `1` dropped, capped at 10. */
function tenDigits(input: string): string {
  const digits = (input ?? "").replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.slice(0, 10);
}

/** Progressively format partial or complete input into `(xxx) xxx-xxxx`. */
export function formatPhoneNumber(input: string): string {
  const d = tenDigits(input);
  if (d.length === 0) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Canonical E.164 (`+1XXXXXXXXXX`), or null when not a valid 10-digit US number. */
export function normalizePhoneToE164(input: string): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** True when input can be normalized to a valid 10-digit US number. */
export function isValidUSPhone(input: string): boolean {
  return normalizePhoneToE164(input) !== null;
}

/**
 * True when `query`'s digits appear within `phone`'s digits — used by the
 * contacts search so a stored E.164 number matches whether the query was
 * typed formatted, as raw digits, or partially.
 */
export function phoneMatchesQuery(phone: string | null | undefined, query: string): boolean {
  const queryDigits = tenDigits(query);
  if (queryDigits.length === 0) return false;
  return tenDigits(phone ?? "").includes(queryDigits);
}

/**
 * Find the first contact whose stored phone matches the given E.164 input.
 * The match is digits-equal on the canonical 10-digit form (NOT substring),
 * so an area code "555" cannot match the local block "555" of an unrelated
 * number. Returns null when the input is not a valid E.164 or no contact
 * matches. Used by `route-inbound` to map a Twilio inbound to a Contact.
 */
export function findContactByPhone<T extends { phone: string | null | undefined }>(
  contacts: readonly T[],
  e164Input: string,
): T | null {
  const inputE164 = normalizePhoneToE164(e164Input);
  if (!inputE164) return null;
  const inputDigits = tenDigits(inputE164);
  for (const c of contacts) {
    if (!c.phone) continue;
    if (tenDigits(c.phone) === inputDigits) return c;
  }
  return null;
}
