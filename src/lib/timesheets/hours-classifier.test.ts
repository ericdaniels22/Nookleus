// hours-classifier — the pure ADR-0020 rule that splits one Time session into
// reason-labelled Regular/Premium segments, evaluated entirely in the passed-in
// Organization timezone. Black-box tested through `classifySession`.
//
// Times are ISO-8601 UTC instants (ADR 0020); the org zone decides every
// boundary (7am/5pm, day-of-week, holiday, midnight split, >8h/day cap). No
// device-local time, no location (ADR 0019/0020).

import { describe, it, expect } from "vitest";
import { classifySession } from "./hours-classifier";

const NO_HOLIDAYS = () => false;

describe("classifySession — a plain weekday session", () => {
  it("classifies a Mon–Fri 9am–5pm (8h) session fully as Regular", () => {
    // 2026-06-19 is a Friday. 9am ET = 13:00Z, 5pm ET = 21:00Z (EDT, UTC-4).
    const result = classifySession(
      {
        startedAt: "2026-06-19T13:00:00Z",
        endedAt: "2026-06-19T21:00:00Z",
      },
      { timeZone: "America/New_York", isHoliday: NO_HOLIDAYS },
    );
    expect(result.regularMinutes).toBe(480);
    expect(result.premiumMinutes).toBe(0);
    expect(result.segments).toEqual([
      { date: "2026-06-19", tier: "regular", reason: "regular", minutes: 480 },
    ]);
  });

  it("marks weekday hours after 5pm as Premium with reason 'evening'", () => {
    // Fri 4pm–7pm ET: 4–5pm Regular, 5–7pm evening Premium.
    const result = classifySession(
      {
        startedAt: "2026-06-19T20:00:00Z", // 4pm ET
        endedAt: "2026-06-19T23:00:00Z", // 7pm ET
      },
      { timeZone: "America/New_York", isHoliday: NO_HOLIDAYS },
    );
    expect(result.segments).toEqual([
      { date: "2026-06-19", tier: "regular", reason: "regular", minutes: 60 },
      { date: "2026-06-19", tier: "premium", reason: "evening", minutes: 120 },
    ]);
  });

  it("marks weekday hours before 7am as Premium with reason 'evening'", () => {
    // Fri 5am–8am ET: 5–7am evening Premium, 7–8am Regular.
    const result = classifySession(
      {
        startedAt: "2026-06-19T09:00:00Z", // 5am ET
        endedAt: "2026-06-19T12:00:00Z", // 8am ET
      },
      { timeZone: "America/New_York", isHoliday: NO_HOLIDAYS },
    );
    expect(result.segments).toEqual([
      { date: "2026-06-19", tier: "premium", reason: "evening", minutes: 120 },
      { date: "2026-06-19", tier: "regular", reason: "regular", minutes: 60 },
    ]);
  });

  it("classifies a whole Saturday session as Premium 'weekend', even in business hours", () => {
    // 2026-06-20 is a Saturday; 9am–5pm ET is inside the weekday window but the
    // weekend rule makes every minute Premium.
    const result = classifySession(
      {
        startedAt: "2026-06-20T13:00:00Z",
        endedAt: "2026-06-20T21:00:00Z",
      },
      { timeZone: "America/New_York", isHoliday: NO_HOLIDAYS },
    );
    expect(result.regularMinutes).toBe(0);
    expect(result.segments).toEqual([
      { date: "2026-06-20", tier: "premium", reason: "weekend", minutes: 480 },
    ]);
  });

  it("classifies a whole Sunday session as Premium 'weekend'", () => {
    // 2026-06-21 is a Sunday.
    const result = classifySession(
      {
        startedAt: "2026-06-21T13:00:00Z",
        endedAt: "2026-06-21T21:00:00Z",
      },
      { timeZone: "America/New_York", isHoliday: NO_HOLIDAYS },
    );
    expect(result.segments).toEqual([
      { date: "2026-06-21", tier: "premium", reason: "weekend", minutes: 480 },
    ]);
  });

  it("classifies a weekday business-hours session as Premium 'holiday' when the day is an observed holiday", () => {
    // 2026-06-18 is a Thursday; the injected calendar marks it a holiday, which
    // beats the in-window Regular rule.
    const result = classifySession(
      {
        startedAt: "2026-06-18T13:00:00Z",
        endedAt: "2026-06-18T21:00:00Z",
      },
      {
        timeZone: "America/New_York",
        isHoliday: (d) => d.year === 2026 && d.month === 6 && d.day === 18,
      },
    );
    expect(result.regularMinutes).toBe(0);
    expect(result.segments).toEqual([
      { date: "2026-06-18", tier: "premium", reason: "holiday", minutes: 480 },
    ]);
  });

  it("pushes weekday hours past the 8th in a day into Premium 'overtime'", () => {
    // Fri 7am–6pm ET (11h). 7am–3pm Regular (8h cap), 3pm–5pm overtime, 5pm–6pm
    // evening.
    const result = classifySession(
      {
        startedAt: "2026-06-19T11:00:00Z", // 7am ET
        endedAt: "2026-06-19T22:00:00Z", // 6pm ET
      },
      { timeZone: "America/New_York", isHoliday: NO_HOLIDAYS },
    );
    expect(result.regularMinutes).toBe(480);
    expect(result.premiumMinutes).toBe(180);
    expect(result.segments).toEqual([
      { date: "2026-06-19", tier: "regular", reason: "regular", minutes: 480 },
      { date: "2026-06-19", tier: "premium", reason: "overtime", minutes: 120 },
      { date: "2026-06-19", tier: "premium", reason: "evening", minutes: 60 },
    ]);
  });

  it("counts a Saturday hour past the 8th as Premium exactly once — weekend, never double-premium (story 44)", () => {
    // Sat 7am–7pm ET (12h). Weekend minutes never enter the Regular budget, so
    // they never become overtime: the whole span is a single Premium 'weekend'
    // stretch, not weekend + overtime stacked.
    const result = classifySession(
      {
        startedAt: "2026-06-20T11:00:00Z", // 7am ET, a Saturday
        endedAt: "2026-06-20T23:00:00Z", // 7pm ET
      },
      { timeZone: "America/New_York", isHoliday: NO_HOLIDAYS },
    );
    expect(result.regularMinutes).toBe(0);
    expect(result.premiumMinutes).toBe(720);
    expect(result.segments).toEqual([
      { date: "2026-06-20", tier: "premium", reason: "weekend", minutes: 720 },
    ]);
    // No stacking: total premium equals the whole session, with no overtime label.
    expect(result.segments.some((s) => s.reason === "overtime")).toBe(false);
  });

  it("splits a session crossing midnight at the org-zone day boundary, attributing each portion to its own date (story 43)", () => {
    // Thu 3pm ET → Fri 1am ET. Thu 3–5pm Regular, Thu 5pm–midnight evening, then
    // the post-midnight hour falls on Friday's date.
    const result = classifySession(
      {
        startedAt: "2026-06-18T19:00:00Z", // Thu 3pm ET
        endedAt: "2026-06-19T05:00:00Z", // Fri 1am ET
      },
      { timeZone: "America/New_York", isHoliday: NO_HOLIDAYS },
    );
    expect(result.segments).toEqual([
      { date: "2026-06-18", tier: "regular", reason: "regular", minutes: 120 },
      { date: "2026-06-18", tier: "premium", reason: "evening", minutes: 420 },
      { date: "2026-06-19", tier: "premium", reason: "evening", minutes: 60 },
    ]);
    expect(result.regularMinutes).toBe(120);
    expect(result.premiumMinutes).toBe(480);
  });

  it("splits the SAME UTC instants differently under two Organization timezones", () => {
    // 22:00Z–02:00Z(+1). Eastern sees 6pm–10pm (all after-hours); Pacific sees
    // 3pm–7pm (half in the Regular window).
    const span = {
      startedAt: "2026-06-19T22:00:00Z",
      endedAt: "2026-06-20T02:00:00Z",
    };
    const eastern = classifySession(span, {
      timeZone: "America/New_York",
      isHoliday: NO_HOLIDAYS,
    });
    const pacific = classifySession(span, {
      timeZone: "America/Los_Angeles",
      isHoliday: NO_HOLIDAYS,
    });
    expect({
      regular: eastern.regularMinutes,
      premium: eastern.premiumMinutes,
    }).toEqual({ regular: 0, premium: 240 });
    expect({
      regular: pacific.regularMinutes,
      premium: pacific.premiumMinutes,
    }).toEqual({ regular: 120, premium: 120 });
  });

  it("honors a per-day Regular budget already spent earlier in the day (cap threads across sessions)", () => {
    // A full Regular day is already booked; this 9am–5pm session is entirely
    // overtime because the day's 8h Regular budget is gone.
    const result = classifySession(
      {
        startedAt: "2026-06-19T13:00:00Z", // 9am ET
        endedAt: "2026-06-19T21:00:00Z", // 5pm ET
      },
      {
        timeZone: "America/New_York",
        isHoliday: NO_HOLIDAYS,
        priorRegularMinutesByDay: { "2026-06-19": 480 },
      },
    );
    expect(result.regularMinutes).toBe(0);
    expect(result.segments).toEqual([
      { date: "2026-06-19", tier: "premium", reason: "overtime", minutes: 480 },
    ]);
    // The day's Regular tally is unchanged (still 8h), ready to thread onward.
    expect(result.regularMinutesByDay["2026-06-19"]).toBe(480);
  });

  it("evaluates every boundary without ever reading the host clock (no ambient time, ADR 0020)", () => {
    // The rule must decide 7am/5pm, day-of-week, holiday and midnight purely
    // from the passed-in instants and zone — never from the device. Trap the two
    // ambient-time reads (`Date.now()` and argless `new Date()`); parsing an
    // explicit instant (`new Date(ms)`, `Date.parse`) carries its own time and
    // stays allowed. If the classifier peeked at the host clock, it would throw.
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
      const result = classifySession(
        {
          startedAt: "2026-06-18T19:00:00Z", // Thu 3pm ET
          endedAt: "2026-06-19T05:00:00Z", // Fri 1am ET — crosses midnight
        },
        { timeZone: "America/New_York", isHoliday: NO_HOLIDAYS },
      );
      // Same split as the midnight-crossing case, proven with the host clock sealed.
      expect(result.segments).toEqual([
        { date: "2026-06-18", tier: "regular", reason: "regular", minutes: 120 },
        { date: "2026-06-18", tier: "premium", reason: "evening", minutes: 420 },
        { date: "2026-06-19", tier: "premium", reason: "evening", minutes: 60 },
      ]);
    } finally {
      globalThis.Date = RealDate;
    }
  });
});
