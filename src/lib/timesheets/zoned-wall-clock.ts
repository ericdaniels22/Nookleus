// src/lib/timesheets/zoned-wall-clock.ts — anchor a typed civil wall-clock in
// the Organization's authoritative timezone to a UTC instant (#706, ADR 0020).
//
// This is the inverse of org-zone's `zonedParts` (instant → civil parts). A
// Correction form gives a lead an HTML datetime-local field — a wall-clock with
// NO zone ("2026-07-01T17:00"). ADR 0020 forbids interpreting that against the
// device's clock; it must be read in the ONE Organization timezone, so the same
// typed "5:00 PM" becomes the same instant no matter which device typed it.
//
// No ambient time (ADR 0020) and no location (ADR 0019): the only inputs are the
// caller's wall-clock string and an IANA zone name. It never reads `Date.now()`
// / argless `new Date()`.

import { zonedParts } from "./org-zone";

const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Resolve a civil wall-clock string ("YYYY-MM-DDTHH:mm", optional ":ss") read in
 * `timeZone` to its UTC instant (an ISO-8601 `…Z` string).
 *
 * Method: treat the wall-clock parts as if they were UTC to get a provisional
 * instant, ask `zonedParts` what civil time the zone actually shows AT that
 * instant, and the difference IS the zone's offset there. Subtract it. One pass
 * is exact for every time outside a DST transition; inside the rare spring-
 * forward gap / fall-back overlap it resolves deterministically to one side.
 */
export function instantFromZonedWallClock(
  wallClock: string,
  timeZone: string,
): string {
  const m = WALL_CLOCK_RE.exec(wallClock.trim());
  if (!m) {
    throw new Error(`invalid wall-clock: ${wallClock}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;

  const provisional = Date.UTC(year, month - 1, day, hour, minute, second);
  const shownParts = zonedParts(provisional, timeZone);
  const shown = Date.UTC(
    shownParts.year,
    shownParts.month - 1,
    shownParts.day,
    shownParts.hour,
    shownParts.minute,
    second,
  );
  const offsetMs = shown - provisional;
  return new Date(provisional - offsetMs).toISOString();
}
