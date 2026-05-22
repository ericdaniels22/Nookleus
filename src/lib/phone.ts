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
