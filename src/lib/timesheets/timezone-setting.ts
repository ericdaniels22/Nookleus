// src/lib/timesheets/timezone-setting.ts — the pure resolver for the single
// authoritative Organization timezone (#704, ADR 0020).
//
// ADR 0020 makes the Organization timezone the one source of truth for every
// labor-hour boundary; this module is the one place that decides WHICH IANA zone
// that is. It turns the Organization's `company_settings` rows plus its saved
// business-address state into an IANA zone name, mirroring the Report-layout
// default resolver (`photo-report-settings.ts`): pure, I/O-free, read-tolerant.
//
// No geocoder and no location (ADR 0019): the only inputs are stored settings
// and a two-letter US state code, and the only output is a chosen zone name. It
// never reads the host clock, so classification is reproducible regardless of
// which device recorded a Time session.

/**
 * The `company_settings` key holding the Organization's chosen timezone — a
 * single IANA zone name. No schema migration: it joins the existing flat
 * `(organization_id, key, value)` store (#704).
 */
export const TIMEZONE_SETTING_KEY = "timezone";

/** The existing `company_settings` key holding the business-address US state. */
export const ADDRESS_STATE_SETTING_KEY = "address_state";

/**
 * The single documented, explicit fallback zone (ADR 0020). When an Organization
 * has neither a stored timezone nor a mappable address state, classification
 * resolves here — never to the host/device-local zone — so labor hours stay
 * deterministic regardless of which device recorded a Time session.
 */
export const FALLBACK_TIME_ZONE = "UTC";

// Static, in-repo US-state → representative IANA-zone map (no geocoder, ADR
// 0019). For states that straddle two zones it names the predominant one; this
// is only a default proposal the owner can override, so it stays deliberately
// coarse — the seven canonical US zones, never an obscure sub-zone that risks a
// typo. Keyed by the two-letter `address_state` code; covers all 50 states + DC.
const US_STATE_TIMEZONES: Record<string, string> = {
  // Eastern
  CT: "America/New_York",
  DE: "America/New_York",
  DC: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  IN: "America/New_York",
  KY: "America/New_York",
  MA: "America/New_York",
  MD: "America/New_York",
  ME: "America/New_York",
  MI: "America/New_York",
  NC: "America/New_York",
  NH: "America/New_York",
  NJ: "America/New_York",
  NY: "America/New_York",
  OH: "America/New_York",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  VA: "America/New_York",
  VT: "America/New_York",
  WV: "America/New_York",
  // Central
  AL: "America/Chicago",
  AR: "America/Chicago",
  IA: "America/Chicago",
  IL: "America/Chicago",
  KS: "America/Chicago",
  LA: "America/Chicago",
  MN: "America/Chicago",
  MO: "America/Chicago",
  MS: "America/Chicago",
  ND: "America/Chicago",
  NE: "America/Chicago",
  OK: "America/Chicago",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  WI: "America/Chicago",
  // Mountain
  CO: "America/Denver",
  ID: "America/Denver",
  MT: "America/Denver",
  NM: "America/Denver",
  UT: "America/Denver",
  WY: "America/Denver",
  // Mountain, no DST
  AZ: "America/Phoenix",
  // Pacific
  CA: "America/Los_Angeles",
  NV: "America/Los_Angeles",
  OR: "America/Los_Angeles",
  WA: "America/Los_Angeles",
  // Alaska & Hawaii
  AK: "America/Anchorage",
  HI: "Pacific/Honolulu",
};

/**
 * Whether `value` is a real IANA zone name. Pure — it asks `Intl` to build a
 * formatter for the zone (which throws a RangeError for an unknown zone) and
 * never reads the host clock. Used to reject a junk or empty stored `timezone`
 * before it can be treated as authoritative (ADR 0020).
 */
export function isValidIanaZone(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Propose the default Organization timezone for a saved business-address state
 * (the existing two-letter US `address_state` code). Returns undefined when the
 * state is absent or unmapped, so the caller falls through the precedence chain.
 */
export function defaultTimeZoneForState(
  state: string | null | undefined,
): string | undefined {
  if (!state) return undefined;
  // The Business Address State is free-text, so normalize before lookup.
  return US_STATE_TIMEZONES[state.trim().toUpperCase()];
}

/**
 * Resolve the effective Organization timezone from its `company_settings` rows.
 * Precedence (ADR 0020):
 *   1. a stored `timezone` value, but only if it is a real IANA zone;
 *   2. else the default derived from the saved business-address state;
 *   3. else the explicit {@link FALLBACK_TIME_ZONE} — never the host/device zone.
 *
 * A junk or empty stored value (1) is rejected and falls through, so a bad write
 * never becomes authoritative (AC4).
 */
export function resolveOrgTimeZone(
  settings: Record<string, string | undefined> | null | undefined,
): string {
  const stored = settings?.[TIMEZONE_SETTING_KEY];
  if (stored && isValidIanaZone(stored)) return stored;
  return (
    defaultTimeZoneForState(settings?.[ADDRESS_STATE_SETTING_KEY]) ??
    FALLBACK_TIME_ZONE
  );
}
