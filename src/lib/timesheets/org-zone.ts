// src/lib/timesheets/org-zone.ts — the irreducible Organization-timezone
// primitive for the pure hours core (#703, ADR 0020).
//
// ADR 0020 requires every classification boundary — the 7am/5pm cutoffs,
// day-of-week, the holiday lookup, the midnight split, and the >8h/day cap — to
// be evaluated in the Organization's single authoritative timezone, never the
// recording device's clock. `zonedParts` is the one place that resolves a UTC
// instant into that zone's civil wall-clock parts, so the rest of the math is
// plain arithmetic on the returned numbers.
//
// No ambient time (ADR 0020) and no location (ADR 0019): the only inputs are a
// caller-supplied UTC instant (epoch milliseconds) and an IANA zone name. It
// never reads `Date.now()` / argless `new Date()`, and there is no lat/long
// anywhere in the interface.

export interface ZonedParts {
  year: number; // civil year in the zone
  month: number; // 1–12
  day: number; // 1–31
  hour: number; // 0–23
  minute: number; // 0–59
  weekday: number; // 0=Sunday … 6=Saturday (matches Date#getUTCDay)
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Resolve a UTC instant (epoch ms) into the given IANA zone's civil parts. */
export function zonedParts(utcMs: number, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")],
  };
}
