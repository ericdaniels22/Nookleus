// org-timezone — the pure resolver (#704, ADR 0020) that turns an Organization's
// flat `company_settings` rows into its single authoritative IANA timezone. The
// precedence is the whole point: a valid stored value wins, else the static
// US-state → IANA default, else the explicit UTC fallback — and NEVER the host's
// device-local zone, so labor-hour classification is deterministic regardless of
// which device recorded a Time session. Black-box tested through the exported
// map, validator, and resolver.

import { describe, it, expect } from "vitest";

import {
  FALLBACK_TIMEZONE,
  TIMEZONE_SETTING_KEY,
  ADDRESS_STATE_SETTING_KEY,
  US_STATE_TO_IANA,
  isValidIanaZone,
  stateToDefaultZone,
  resolveOrganizationTimezone,
} from "./org-timezone";
import { classifySession } from "./hours-classifier";

describe("stateToDefaultZone — the static US-state → IANA map", () => {
  // Representative states across every distinct US zone (ADR 0020: no geocoder,
  // a small in-repo table).
  const cases: Array<[string, string]> = [
    ["TX", "America/Chicago"],
    ["NY", "America/New_York"],
    ["CA", "America/Los_Angeles"],
    ["CO", "America/Denver"],
    ["AZ", "America/Phoenix"],
    ["AK", "America/Anchorage"],
    ["HI", "Pacific/Honolulu"],
    ["FL", "America/New_York"],
    ["IL", "America/Chicago"],
  ];

  it.each(cases)("maps %s → %s", (state, zone) => {
    expect(stateToDefaultZone(state)).toBe(zone);
  });

  it("is case- and whitespace-tolerant (address_state is a free field)", () => {
    expect(stateToDefaultZone("tx")).toBe("America/Chicago");
    expect(stateToDefaultZone("  ca ")).toBe("America/Los_Angeles");
  });

  it("returns undefined for a blank or unmappable state", () => {
    expect(stateToDefaultZone("")).toBeUndefined();
    expect(stateToDefaultZone("  ")).toBeUndefined();
    expect(stateToDefaultZone("ZZ")).toBeUndefined();
    expect(stateToDefaultZone(null)).toBeUndefined();
    expect(stateToDefaultZone(undefined)).toBeUndefined();
  });

  it("maps every covered state to a zone the runtime recognises", () => {
    for (const zone of Object.values(US_STATE_TO_IANA)) {
      expect(isValidIanaZone(zone)).toBe(true);
    }
  });
});

describe("isValidIanaZone — only a real IANA name is authoritative", () => {
  it("accepts real zones, including the UTC fallback", () => {
    expect(isValidIanaZone("America/Chicago")).toBe(true);
    expect(isValidIanaZone("Europe/London")).toBe(true);
    expect(isValidIanaZone("UTC")).toBe(true);
  });

  it("rejects empty, blank, and malformed names", () => {
    expect(isValidIanaZone("")).toBe(false);
    expect(isValidIanaZone("   ")).toBe(false);
    expect(isValidIanaZone("Not/AZone")).toBe(false);
    expect(isValidIanaZone("America/Nowhere")).toBe(false);
    expect(isValidIanaZone(null)).toBe(false);
    expect(isValidIanaZone(undefined)).toBe(false);
  });
});

describe("resolveOrganizationTimezone — precedence", () => {
  it("a valid stored timezone wins over the address-derived default", () => {
    // TX would propose Central, but the owner explicitly saved Eastern.
    const settings = {
      [TIMEZONE_SETTING_KEY]: "America/New_York",
      [ADDRESS_STATE_SETTING_KEY]: "TX",
    };
    expect(resolveOrganizationTimezone(settings)).toBe("America/New_York");
  });

  it("falls back to the address-derived default when no timezone is stored", () => {
    expect(
      resolveOrganizationTimezone({ [ADDRESS_STATE_SETTING_KEY]: "TX" }),
    ).toBe("America/Chicago");
  });

  it("rejects an INVALID stored value and falls through to the address default", () => {
    // A bad stored value must never be treated as authoritative (it would make
    // classification non-deterministic) — it falls through to the state map.
    expect(
      resolveOrganizationTimezone({
        [TIMEZONE_SETTING_KEY]: "Garbage/Zone",
        [ADDRESS_STATE_SETTING_KEY]: "CA",
      }),
    ).toBe("America/Los_Angeles");
  });

  it("rejects an EMPTY stored value and falls through to the address default", () => {
    expect(
      resolveOrganizationTimezone({
        [TIMEZONE_SETTING_KEY]: "",
        [ADDRESS_STATE_SETTING_KEY]: "CO",
      }),
    ).toBe("America/Denver");
  });

  it("resolves to the explicit UTC fallback with neither a stored value nor a mappable state", () => {
    expect(resolveOrganizationTimezone({})).toBe(FALLBACK_TIMEZONE);
    expect(resolveOrganizationTimezone(null)).toBe(FALLBACK_TIMEZONE);
    expect(resolveOrganizationTimezone(undefined)).toBe(FALLBACK_TIMEZONE);
    expect(
      resolveOrganizationTimezone({ [ADDRESS_STATE_SETTING_KEY]: "ZZ" }),
    ).toBe(FALLBACK_TIMEZONE);
    expect(FALLBACK_TIMEZONE).toBe("UTC");
  });

  it("never resolves to the host/device-local zone for an unconfigured Organization", () => {
    // Whatever the process clock is, an Organization that has set nothing
    // classifies in UTC — not in `Intl`'s resolved host zone.
    const hostZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const resolved = resolveOrganizationTimezone({});
    expect(resolved).toBe("UTC");
    if (hostZone !== "UTC") {
      expect(resolved).not.toBe(hostZone);
    }
  });
});

describe("server-side classification obtains its zone through the resolver", () => {
  // ADR 0020: classifying the same Time session must yield identical
  // Regular/Premium hours irrespective of the process/host timezone, because the
  // boundary math runs in the resolver's zone, never the host clock.
  function classifyUnderHostTz(hostTz: string, timeZone: string) {
    const prev = process.env.TZ;
    process.env.TZ = hostTz;
    try {
      return classifySession(
        // 13:00–20:00 UTC on Fri 2026-06-19 = 08:00–15:00 in America/Chicago
        // (CDT, UTC-5): a 7h weekday business-hours span, all Regular.
        { startedAt: "2026-06-19T13:00:00Z", endedAt: "2026-06-19T20:00:00Z" },
        { timeZone, isHoliday: () => false },
      );
    } finally {
      process.env.TZ = prev;
    }
  }

  it("yields identical hours under wildly different host timezones, matching the resolver's zone", () => {
    // The zone comes ONLY from the resolver — a TX Organization → Central.
    const zone = resolveOrganizationTimezone({
      [ADDRESS_STATE_SETTING_KEY]: "TX",
    });
    expect(zone).toBe("America/Chicago");

    const utc = classifyUnderHostTz("UTC", zone);
    const farEast = classifyUnderHostTz("Pacific/Kiritimati", zone); // UTC+14
    const west = classifyUnderHostTz("America/Los_Angeles", zone);

    // Host-independent by construction: all three agree.
    expect(farEast.regularMinutes).toBe(utc.regularMinutes);
    expect(west.regularMinutes).toBe(utc.regularMinutes);
    expect(farEast.premiumMinutes).toBe(utc.premiumMinutes);
    expect(west.premiumMinutes).toBe(utc.premiumMinutes);

    // And the answer is the Central-zone answer (7h Regular), not what a
    // host-local bucketing of 13:00–20:00 UTC would have produced.
    expect(utc.regularMinutes).toBe(7 * 60);
    expect(utc.premiumMinutes).toBe(0);
  });
});
