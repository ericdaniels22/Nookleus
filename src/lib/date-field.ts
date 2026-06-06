// Pure date helpers for the masked MM/DD/YYYY intake field (PRD #45, issue #184).

/** Strip non-digits and progressively format input into `MM/DD/YYYY`. */
export function maskDateInput(input: string): string {
  const d = (input ?? "").replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** Parse a complete `MM/DD/YYYY` string into a local-midnight Date, or null. */
export function parseMaskedDate(input: string): Date | null {
  const m = (input ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(year, month - 1, day);
  // Reject roll-over from non-existent dates (e.g. 02/30 → Mar 1).
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/**
 * Parse a Postgres `date` string (`"YYYY-MM-DD"`) into a **local**-midnight Date.
 *
 * `new Date("YYYY-MM-DD")` parses as UTC midnight, so formatting it in the host's
 * local timezone renders the previous calendar day in any UTC-minus (US) zone.
 * Constructing from the parts keeps the calendar day the user actually set.
 */
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** True when input is a complete, real `MM/DD/YYYY` date that is not in the future. */
export function isValidPastDate(input: string): boolean {
  const date = parseMaskedDate(input);
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() <= today.getTime();
}
