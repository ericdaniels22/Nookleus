// AC5 (#704) — server-side hour classification must obtain its zone exclusively
// through the Organization-timezone resolver, never host-local boundary math. So
// classifying the SAME Time session must yield identical Regular/Premium hours
// no matter which device — or process timezone — runs the classification.
//
// This composes the two pure pieces the way a server path will: resolve the zone
// from the Organization's `company_settings` rows, then classify in that zone.
// (No server route consumes these libs yet — that is a downstream epic issue;
// this proves the seam an eventual route will rely on, ADR 0020.)

import { describe, it, expect } from "vitest";
import { resolveOrgTimeZone } from "./timezone-setting";
import { classifySession } from "./hours-classifier";

const NO_HOLIDAYS = () => false;

// An Organization with no stored timezone but an Eastern (NY) business address
// resolves to America/New_York. A Friday 7am–6pm ET session is 8h Regular plus
// 3h Premium (2h overtime past the 8h cap + 1h evening after 5pm) — the same
// split the classifier's own suite documents.
const SETTINGS = { address_state: "NY" };
const SESSION = {
  startedAt: "2026-06-19T11:00:00Z", // Fri 7am ET
  endedAt: "2026-06-19T22:00:00Z", // Fri 6pm ET
};

function classifyViaResolver() {
  const timeZone = resolveOrgTimeZone(SETTINGS);
  return classifySession(SESSION, { timeZone, isHoliday: NO_HOLIDAYS });
}

describe("AC5 — classification via the resolver is host-timezone-independent", () => {
  it("yields identical Regular/Premium minutes under any process/host timezone", () => {
    const original = process.env.TZ;
    const results: ReturnType<typeof classifyViaResolver>[] = [];
    try {
      for (const tz of [
        "UTC",
        "America/Los_Angeles",
        "Asia/Kolkata",
        "Pacific/Kiritimati", // UTC+14 — as far from the org zone as it gets
      ]) {
        process.env.TZ = tz;
        results.push(classifyViaResolver());
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }

    for (const r of results) {
      expect(r.regularMinutes).toBe(480);
      expect(r.premiumMinutes).toBe(180);
    }
    // Every run is byte-for-byte the same split, not merely the same totals.
    for (const r of results) {
      expect(r.segments).toEqual(results[0].segments);
    }
  });

  it("decides every boundary without ever reading the host clock (no ambient time)", () => {
    // Seal the two ambient-time reads. If resolve→classify peeked at the device
    // clock to place a boundary, this would throw rather than classify.
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
      const r = classifyViaResolver();
      expect(r.regularMinutes).toBe(480);
      expect(r.premiumMinutes).toBe(180);
    } finally {
      globalThis.Date = RealDate;
    }
  });
});
