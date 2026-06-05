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
 * Parse a date-only string (`YYYY-MM-DD`, e.g. a Postgres `date` column) into a
 * local-midnight Date. `new Date("YYYY-MM-DD")` parses as UTC midnight, which
 * renders as the previous calendar day in negative-UTC (US) timezones; building
 * the Date from its parts pins it to the user's local day (issue #444). Any
 * trailing time component is ignored; non-date input falls back to `Date`'s own
 * parsing (yielding an Invalid Date that callers can detect).
 */
export function parseDateOnly(input: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  return m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(input);
}

/** True when input is a complete, real `MM/DD/YYYY` date that is not in the future. */
export function isValidPastDate(input: string): boolean {
  const date = parseMaskedDate(input);
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() <= today.getTime();
}
