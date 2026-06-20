// org-zone — the irreducible "what civil day/time is this UTC instant, in the
// Organization timezone" primitive that ADR 0020 demands. Every classification
// boundary (7am/5pm, day-of-week, the >8h/day cap, the holiday lookup, the
// midnight split) is evaluated in the passed-in Organization zone, never the
// host's clock — so this is the one place that resolves an instant into a zone's
// wall-clock parts. Black-box tested through `zonedParts`.

import { describe, it, expect } from "vitest";
import { zonedParts } from "./org-zone";

describe("zonedParts — resolves a UTC instant into an Organization zone's civil parts", () => {
  it("renders a UTC noon instant as the morning wall-clock of US Eastern (UTC-4 in June)", () => {
    // 2026-06-19 is a Friday. Noon UTC is 08:00 EDT.
    const ms = Date.parse("2026-06-19T12:00:00Z");
    expect(zonedParts(ms, "America/New_York")).toEqual({
      year: 2026,
      month: 6,
      day: 19,
      hour: 8,
      minute: 0,
      weekday: 5, // 0=Sunday … 6=Saturday; Friday = 5
    });
  });

  it("places the same instant on different calendar days depending on the zone", () => {
    // 02:00 UTC on the 20th is still the evening of the 19th out west, but the
    // small hours of the 20th in London — the civil DAY itself differs.
    const ms = Date.parse("2026-06-20T02:00:00Z");
    const eastern = zonedParts(ms, "America/New_York");
    const london = zonedParts(ms, "Europe/London");
    expect(eastern.day).toBe(19);
    expect(eastern.hour).toBe(22);
    expect(london.day).toBe(20);
    expect(london.hour).toBe(3);
  });
});
