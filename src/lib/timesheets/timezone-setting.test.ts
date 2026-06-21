// timezone-setting — the pure resolver that turns an Organization's
// `company_settings` rows plus its saved business-address state into the single
// authoritative Organization timezone (an IANA zone name) that ADR-0020 hour
// classification reads. No I/O, no geocoder, no device-local time (ADR 0019/0020).
// Black-box tested through its public functions.

import { describe, it, expect } from "vitest";
import {
  defaultTimeZoneForState,
  isValidIanaZone,
  resolveOrgTimeZone,
  FALLBACK_TIME_ZONE,
} from "./timezone-setting";

describe("defaultTimeZoneForState — static US-state → IANA map", () => {
  it("proposes America/Chicago for a Texas (TX) business address", () => {
    expect(defaultTimeZoneForState("TX")).toBe("America/Chicago");
  });

  it.each([
    ["NY", "America/New_York"], // Eastern
    ["FL", "America/New_York"], // Eastern
    ["CA", "America/Los_Angeles"], // Pacific
    ["CO", "America/Denver"], // Mountain
    ["AZ", "America/Phoenix"], // Mountain, no DST
    ["AK", "America/Anchorage"], // Alaska
    ["HI", "Pacific/Honolulu"], // Hawaii
  ])("proposes %s → %s for a representative business-address state", (state, zone) => {
    expect(defaultTimeZoneForState(state)).toBe(zone);
  });

  it("normalizes case and surrounding whitespace (the State field is free-text)", () => {
    // The Business Address State is a free-text 2-char input, so it can arrive
    // lower-cased or padded; the proposal must still resolve.
    expect(defaultTimeZoneForState("tx")).toBe("America/Chicago");
    expect(defaultTimeZoneForState(" Tx ")).toBe("America/Chicago");
    expect(defaultTimeZoneForState("ca")).toBe("America/Los_Angeles");
  });
});

describe("defaultTimeZoneForState — full 50-states-plus-DC coverage", () => {
  // Every US jurisdiction an `address_state` code can hold must propose SOME
  // zone, and that zone must be a real IANA name (AC3). The values themselves
  // are spot-checked above; here we prove the map is complete and never points
  // at a typo'd zone.
  const ALL_JURISDICTIONS = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC",
  ];

  it("covers all 50 states plus DC", () => {
    expect(ALL_JURISDICTIONS).toHaveLength(51);
  });

  it.each(ALL_JURISDICTIONS)("maps %s to a valid IANA zone", (state) => {
    const zone = defaultTimeZoneForState(state);
    expect(zone).toBeDefined();
    expect(isValidIanaZone(zone)).toBe(true);
  });
});

describe("resolveOrgTimeZone — the effective Organization timezone", () => {
  it("proposes the address-state default when no timezone key is stored", () => {
    expect(resolveOrgTimeZone({ address_state: "TX" })).toBe("America/Chicago");
  });

  it("uses a stored valid IANA timezone over the address-state default", () => {
    expect(
      resolveOrgTimeZone({ timezone: "America/New_York", address_state: "TX" }),
    ).toBe("America/New_York");
  });

  it("rejects an invalid or empty stored timezone and falls through to the address-state default (AC4)", () => {
    // A junk or blank stored value must never be treated as authoritative.
    expect(
      resolveOrgTimeZone({ timezone: "Not/ARealZone", address_state: "TX" }),
    ).toBe("America/Chicago");
    expect(
      resolveOrgTimeZone({ timezone: "", address_state: "CA" }),
    ).toBe("America/Los_Angeles");
    expect(
      resolveOrgTimeZone({ timezone: "   ", address_state: "CA" }),
    ).toBe("America/Los_Angeles");
  });

  it("resolves to the explicit UTC fallback — never the host zone — with neither a stored value nor a mappable state (AC3)", () => {
    expect(resolveOrgTimeZone({})).toBe(FALLBACK_TIME_ZONE);
    expect(resolveOrgTimeZone(null)).toBe("UTC");
    expect(resolveOrgTimeZone(undefined)).toBe("UTC");
    expect(resolveOrgTimeZone({ address_state: "ZZ" })).toBe("UTC"); // unmapped

    // And it reaches that fallback without ever reading the host clock/zone:
    // trap the two ambient-time reads (argless `new Date()` and `Date.now()`).
    // If the resolver peeked at the device to decide a default, this throws.
    const RealDate = globalThis.Date;
    class NoAmbientDate extends RealDate {
      constructor(...args: [] | ConstructorParameters<typeof Date>) {
        if (args.length === 0) {
          throw new Error("ambient time read: argless new Date()");
        }
        super(...args);
      }
      static now(): number {
        throw new Error("ambient time read: Date.now()");
      }
    }
    globalThis.Date = NoAmbientDate as DateConstructor;
    try {
      expect(resolveOrgTimeZone({ address_state: "ZZ" })).toBe("UTC");
    } finally {
      globalThis.Date = RealDate;
    }
  });
});

describe("isValidIanaZone — guards stored values against junk", () => {
  it("accepts a real IANA zone name", () => {
    expect(isValidIanaZone("America/Chicago")).toBe(true);
  });

  it("rejects a non-existent zone name", () => {
    expect(isValidIanaZone("Not/ARealZone")).toBe(false);
  });

  it("rejects an empty or missing value", () => {
    expect(isValidIanaZone("")).toBe(false);
    expect(isValidIanaZone(undefined)).toBe(false);
  });
});
