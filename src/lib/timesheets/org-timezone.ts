// src/lib/timesheets/org-timezone.ts — the pure resolver for the authoritative
// Organization timezone (#704, ADR 0020), mirroring the Report-layout-default
// resolver in `photo-report-settings.ts`. No I/O, no ambient clock, no location.
//
// ADR 0020 requires labor-hour classification to bucket every boundary (the
// 7am/5pm cutoffs, day-of-week, the >8h/day cap, the holiday lookup, the
// midnight split) in ONE authoritative Organization timezone — never the
// recording device's clock. This module turns an Organization's flat
// `company_settings` key-value rows into that single effective IANA zone, so the
// Settings UI (for the default proposal) and every server-side classification
// path resolve through the exact same precedence.
//
// Precedence: a valid stored `timezone` key wins; else a default derived purely
// from the saved business-address state (`address_state`) via the static
// US-state → IANA map below; else a single documented fallback (UTC). It NEVER
// falls back to the host's device-local zone — an Organization that has set
// nothing classifies deterministically in UTC, identically on every device.
//
// Per ADR 0019 this captures no location of any kind — only a chosen timezone
// name. There is no geocoder; the state→zone map is a small static table.

/** The `company_settings` key holding the chosen Organization timezone. */
export const TIMEZONE_SETTING_KEY = "timezone";

/** The pre-existing `company_settings` key holding the two-letter US state. */
export const ADDRESS_STATE_SETTING_KEY = "address_state";

/**
 * The single documented, explicit fallback zone (ADR 0020). Used only when an
 * Organization has neither a valid stored `timezone` nor a mappable address
 * state — classification still resolves deterministically, never to the host's
 * `new Date()` local zone.
 */
export const FALLBACK_TIMEZONE = "UTC";

/**
 * The static US-state (two-letter code) → IANA zone map. No geocoder, no
 * external API (ADR 0019): a small in-repo table proposing one sensible zone per
 * state. States spanning two zones map to the one their capital/majority sits in
 * (e.g. TN/Nashville → Central, FL/majority → Eastern); the owner can always
 * override the proposal in Settings.
 */
export const US_STATE_TO_IANA: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix", // no DST
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  DC: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Denver",
  IL: "America/Chicago",
  IN: "America/New_York",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/New_York",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
};

/**
 * The distinct IANA zones an Organization can pick in Settings, in geographic
 * (east → west) order, each with a friendly label. Sourced from the state map
 * plus the explicit UTC fallback, so the Settings dropdown and the proposal map
 * stay in sync from one place.
 */
export const TIMEZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain — no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "UTC", label: "UTC" },
];

/**
 * True when `value` is a real IANA zone name the runtime recognises. Pure: it
 * asks `Intl` to build a formatter for the zone, which throws `RangeError` for
 * an unknown or malformed name. An empty/whitespace value is never valid — so a
 * blank stored `timezone` is rejected rather than treated as authoritative.
 */
export function isValidIanaZone(
  value: string | null | undefined,
): value is string {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  try {
    // Constructing the formatter validates the zone; an unknown name throws.
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * The IANA zone proposed for a US state code, or undefined when the state is
 * blank/unmappable. Case- and whitespace-tolerant: `address_state` is a free
 * two-letter field that may arrive lowercase or padded.
 */
export function stateToDefaultZone(
  state: string | null | undefined,
): string | undefined {
  const code = state?.trim().toUpperCase();
  if (!code) return undefined;
  return US_STATE_TO_IANA[code];
}

/**
 * Resolve an Organization's effective IANA timezone from its flat
 * `company_settings` record (a `key → value` string map; `address_state` is one
 * of those keys). Precedence, per ADR 0020:
 *
 *   1. a VALID stored `timezone` value wins (a blank or non-IANA value is
 *      rejected and falls through — never treated as authoritative);
 *   2. else the static map's zone for the saved business-address state;
 *   3. else the explicit documented {@link FALLBACK_TIMEZONE} (UTC).
 *
 * It never reads the host's `new Date()` local zone, so the same Time session
 * classifies to identical hours regardless of which device recorded it. When no
 * `timezone` is stored, the return value IS the proposal the Settings UI shows —
 * one resolver serves both the UI default and server-side classification.
 */
export function resolveOrganizationTimezone(
  settings: Record<string, string | undefined> | null | undefined,
): string {
  const stored = settings?.[TIMEZONE_SETTING_KEY];
  if (isValidIanaZone(stored)) return stored.trim();

  const fromState = stateToDefaultZone(settings?.[ADDRESS_STATE_SETTING_KEY]);
  if (fromState) return fromState;

  return FALLBACK_TIMEZONE;
}
