// timesheet-aggregator — the pure transform from a Job's Time sessions over a
// date range into the deliverable the on-screen preview and the PDF renderer
// both consume: a per-worker summary (Regular/Premium/Total), that worker's
// chronological detail rows (each carrying the Regular/Premium split, the
// Premium reason labels, and a live-vs-hand-entered capture marker), and grand
// totals across all workers.
//
// It drives the hour classifier and the federal-holiday calendar; it performs
// no I/O, reads no ambient clock, and never touches latitude/longitude
// (ADR 0019/0020). Timezone and holiday data come in as parameters. Black-box
// tested through `aggregateTimesheet`.

import { describe, it, expect } from "vitest";
import { aggregateTimesheet } from "./timesheet-aggregator";

const NO_HOLIDAYS = () => false;
const ET = "America/New_York";

// A whole June 2026 window, so range filtering never trims the base cases.
const JUNE_2026 = { start: "2026-06-01", end: "2026-06-30" };

describe("aggregateTimesheet — one worker, one plain weekday session", () => {
  it("produces a Regular-only detail row, a matching worker summary, and grand totals", () => {
    // 2026-06-19 is a Friday; 9am–5pm ET (13:00Z–21:00Z) is a clean 8h Regular day.
    const summary = aggregateTimesheet(
      [
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-19T13:00:00Z",
          endedAt: "2026-06-19T21:00:00Z",
          capture: "live",
        },
      ],
      { timeZone: ET, isHoliday: NO_HOLIDAYS, range: JUNE_2026 },
    );

    expect(summary.workers).toEqual([
      {
        worker: { userId: "u1", name: "Avery" },
        regularMinutes: 480,
        premiumMinutes: 0,
        totalMinutes: 480,
        rows: [
          {
            worker: { userId: "u1", name: "Avery" },
            date: "2026-06-19",
            startedAt: "2026-06-19T13:00:00Z",
            endedAt: "2026-06-19T21:00:00Z",
            capture: "live",
            regularMinutes: 480,
            premiumMinutes: 0,
            premiumReasons: [],
          },
        ],
      },
    ]);
    expect(summary.grandTotal).toEqual({
      regularMinutes: 480,
      premiumMinutes: 0,
      totalMinutes: 480,
    });
  });

  it("orders a worker's sessions chronologically and sums them into the worker summary (AC7)", () => {
    // Two sessions on different calendar days (so the daily cap never couples
    // them), fed in reverse order. Mon 2026-06-22 9am–1pm ET = 240 Regular;
    // Fri 2026-06-19 9am–5pm ET = 480 Regular.
    const summary = aggregateTimesheet(
      [
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-22T13:00:00Z", // Monday — later, given first
          endedAt: "2026-06-22T17:00:00Z",
          capture: "live",
        },
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-19T13:00:00Z", // Friday — earlier, given second
          endedAt: "2026-06-19T21:00:00Z",
          capture: "live",
        },
      ],
      { timeZone: ET, isHoliday: NO_HOLIDAYS, range: JUNE_2026 },
    );

    expect(summary.workers).toHaveLength(1);
    const avery = summary.workers[0];
    // Rows are chronological by clock-in: Friday the 19th before Monday the 22nd.
    expect(avery.rows.map((r) => r.date)).toEqual(["2026-06-19", "2026-06-22"]);
    // The worker summary is exactly the sum of that worker's detail rows.
    expect(avery.regularMinutes).toBe(720);
    expect(avery.premiumMinutes).toBe(0);
    expect(avery.totalMinutes).toBe(720);
    expect(avery.regularMinutes).toBe(
      avery.rows.reduce((sum, r) => sum + r.regularMinutes, 0),
    );
    expect(summary.grandTotal).toEqual({
      regularMinutes: 720,
      premiumMinutes: 0,
      totalMinutes: 720,
    });
  });

  it("threads the daily 8h cap across a worker's same-day sessions, pushing the overflow to overtime (AC5)", () => {
    // Two Friday 2026-06-19 sessions, both inside 7am–5pm: 7am–1pm (6h) then
    // 1pm–4pm (3h) = 9h on one day. The 9th hour is over the daily cap, so the
    // last 60 minutes of the second session are Premium overtime.
    const summary = aggregateTimesheet(
      [
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-19T11:00:00Z", // 7am ET
          endedAt: "2026-06-19T17:00:00Z", // 1pm ET (6h)
          capture: "live",
        },
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-19T17:00:00Z", // 1pm ET
          endedAt: "2026-06-19T20:00:00Z", // 4pm ET (3h)
          capture: "live",
        },
      ],
      { timeZone: ET, isHoliday: NO_HOLIDAYS, range: JUNE_2026 },
    );

    const avery = summary.workers[0];
    // First session: all 6h Regular. Second: 2h fills the cap, last 1h overtime.
    expect(avery.rows[0]).toMatchObject({
      regularMinutes: 360,
      premiumMinutes: 0,
      premiumReasons: [],
    });
    expect(avery.rows[1]).toMatchObject({
      regularMinutes: 120,
      premiumMinutes: 60,
      premiumReasons: ["overtime"],
    });
    // The day caps Regular at 8h; the rest is Premium overtime.
    expect(avery.regularMinutes).toBe(480);
    expect(avery.premiumMinutes).toBe(60);
    expect(avery.totalMinutes).toBe(540);
  });

  it("keeps the cap daily-only: the same 9h spread across two days has no overtime (AC5, no weekly accumulator)", () => {
    // The same 9 hours as above, but split 4h Friday + 5h Monday. Neither day
    // reaches the 8h cap, so nothing is overtime — proving there is no weekly
    // (>40h) accumulator coupling days together.
    const summary = aggregateTimesheet(
      [
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-19T11:00:00Z", // Fri 7am ET
          endedAt: "2026-06-19T15:00:00Z", // 11am ET (4h)
          capture: "live",
        },
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-22T11:00:00Z", // Mon 7am ET
          endedAt: "2026-06-22T16:00:00Z", // 12pm ET (5h)
          capture: "live",
        },
      ],
      { timeZone: ET, isHoliday: NO_HOLIDAYS, range: JUNE_2026 },
    );

    const avery = summary.workers[0];
    expect(avery.regularMinutes).toBe(540);
    expect(avery.premiumMinutes).toBe(0);
    expect(avery.rows.every((r) => r.premiumReasons.length === 0)).toBe(true);
  });
});

describe("aggregateTimesheet — several workers", () => {
  it("rolls each worker up separately and the grand total is the sum across all workers (AC7)", () => {
    // Avery works Friday (Regular); Blake works Saturday (weekend Premium).
    // Blake's session is fed first, but Avery's earlier clock-in orders her first.
    const summary = aggregateTimesheet(
      [
        {
          worker: { userId: "u2", name: "Blake" },
          startedAt: "2026-06-20T13:00:00Z", // Saturday 9am ET
          endedAt: "2026-06-20T21:00:00Z",
          capture: "live",
        },
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-19T13:00:00Z", // Friday 9am ET
          endedAt: "2026-06-19T21:00:00Z",
          capture: "live",
        },
      ],
      { timeZone: ET, isHoliday: NO_HOLIDAYS, range: JUNE_2026 },
    );

    // Workers ordered by earliest session: Avery (Fri) before Blake (Sat).
    expect(summary.workers.map((w) => w.worker.name)).toEqual([
      "Avery",
      "Blake",
    ]);

    const [avery, blake] = summary.workers;
    expect(avery).toMatchObject({ regularMinutes: 480, premiumMinutes: 0 });
    expect(blake).toMatchObject({ regularMinutes: 0, premiumMinutes: 480 });
    expect(blake.rows[0].premiumReasons).toEqual(["weekend"]);

    // Each worker's total equals the sum of that worker's rows.
    for (const w of summary.workers) {
      expect(w.regularMinutes).toBe(
        w.rows.reduce((sum, r) => sum + r.regularMinutes, 0),
      );
      expect(w.premiumMinutes).toBe(
        w.rows.reduce((sum, r) => sum + r.premiumMinutes, 0),
      );
    }

    // The grand total equals the sum across all workers.
    expect(summary.grandTotal).toEqual({
      regularMinutes: 480,
      premiumMinutes: 480,
      totalMinutes: 960,
    });
  });
});

describe("aggregateTimesheet — the date range", () => {
  it("keeps only sessions whose clock-in day falls within the range, inclusive of both ends (AC7)", () => {
    // Range is June 1–15 2026 (org zone). Of the three sessions only the one
    // clocking in on the 15th (the inclusive end) belongs; the 16th is just past
    // the end and May 31 is before the start.
    const summary = aggregateTimesheet(
      [
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-16T13:00:00Z", // Tue Jun 16 — past the end
          endedAt: "2026-06-16T21:00:00Z",
          capture: "live",
        },
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-15T13:00:00Z", // Mon Jun 15 — on the inclusive end
          endedAt: "2026-06-15T21:00:00Z",
          capture: "live",
        },
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-05-31T13:00:00Z", // Sun May 31 — before the start
          endedAt: "2026-05-31T21:00:00Z",
          capture: "live",
        },
      ],
      {
        timeZone: ET,
        isHoliday: NO_HOLIDAYS,
        range: { start: "2026-06-01", end: "2026-06-15" },
      },
    );

    expect(summary.workers).toHaveLength(1);
    expect(summary.workers[0].rows.map((r) => r.date)).toEqual(["2026-06-15"]);
    expect(summary.workers[0].regularMinutes).toBe(480);
    expect(summary.grandTotal.regularMinutes).toBe(480);
  });

  it("drops a worker entirely when every one of their sessions is outside the range", () => {
    // Avery is in range; Blake's only session is after the range and must not
    // appear as a worker at all.
    const summary = aggregateTimesheet(
      [
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-10T13:00:00Z",
          endedAt: "2026-06-10T21:00:00Z",
          capture: "live",
        },
        {
          worker: { userId: "u2", name: "Blake" },
          startedAt: "2026-07-01T13:00:00Z", // outside the June range
          endedAt: "2026-07-01T21:00:00Z",
          capture: "live",
        },
      ],
      {
        timeZone: ET,
        isHoliday: NO_HOLIDAYS,
        range: { start: "2026-06-01", end: "2026-06-30" },
      },
    );

    expect(summary.workers.map((w) => w.worker.name)).toEqual(["Avery"]);
  });
});

describe("aggregateTimesheet — worker identity and the capture marker", () => {
  it("keeps an Off-app worker distinct from an app User of the same name and carries the hand-entered marker", () => {
    // An app User "Sam" who live-clocked, and an Off-app worker also named "Sam"
    // (no user id, hand-entered by a lead). They are different people and must
    // never merge despite the shared name.
    const summary = aggregateTimesheet(
      [
        {
          worker: { userId: "u1", name: "Sam" },
          startedAt: "2026-06-19T13:00:00Z", // Fri 9am–5pm ET
          endedAt: "2026-06-19T21:00:00Z",
          capture: "live",
        },
        {
          worker: { name: "Sam" }, // Off-app worker: just a typed name
          startedAt: "2026-06-19T13:00:00Z", // Fri 9am–1pm ET
          endedAt: "2026-06-19T17:00:00Z",
          capture: "hand",
        },
      ],
      { timeZone: ET, isHoliday: NO_HOLIDAYS, range: JUNE_2026 },
    );

    // Two distinct workers, not one merged "Sam".
    expect(summary.workers).toHaveLength(2);

    const appUser = summary.workers.find((w) => w.worker.userId === "u1");
    const offApp = summary.workers.find((w) => w.worker.userId === undefined);
    expect(appUser?.rows[0].capture).toBe("live");
    expect(appUser?.regularMinutes).toBe(480);
    expect(offApp?.rows[0].capture).toBe("hand");
    expect(offApp?.regularMinutes).toBe(240);

    // Grand total still spans both.
    expect(summary.grandTotal.regularMinutes).toBe(720);
  });
});

describe("aggregateTimesheet — how a row labels Premium", () => {
  it("labels a row with each distinct Premium reason it contains, in order (AC1/AC7)", () => {
    // Fri 7am–6pm ET (11h): 8h Regular, then overtime, then after-5pm evening —
    // a single row carrying both Premium reasons in segment order.
    const summary = aggregateTimesheet(
      [
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-19T11:00:00Z", // 7am ET
          endedAt: "2026-06-19T22:00:00Z", // 6pm ET
          capture: "live",
        },
      ],
      { timeZone: ET, isHoliday: NO_HOLIDAYS, range: JUNE_2026 },
    );

    const row = summary.workers[0].rows[0];
    expect(row.regularMinutes).toBe(480);
    expect(row.premiumMinutes).toBe(180);
    expect(row.premiumReasons).toEqual(["overtime", "evening"]);
  });

  it("presents a midnight-crossing session as one row dated to its clock-in day (AC3)", () => {
    // Thu 3pm ET → Fri 1am ET is a single session, so it is a single detail row
    // dated to the Thursday it began, even though its hours land on two days.
    const summary = aggregateTimesheet(
      [
        {
          worker: { userId: "u1", name: "Avery" },
          startedAt: "2026-06-18T19:00:00Z", // Thu 3pm ET
          endedAt: "2026-06-19T05:00:00Z", // Fri 1am ET
          capture: "live",
        },
      ],
      { timeZone: ET, isHoliday: NO_HOLIDAYS, range: JUNE_2026 },
    );

    const rows = summary.workers[0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: "2026-06-18",
      regularMinutes: 120,
      premiumMinutes: 480,
      premiumReasons: ["evening"],
    });
  });
});

describe("aggregateTimesheet — purity (AC8/AC4)", () => {
  it("computes everything without ever reading the host clock (no ambient time)", () => {
    // Seal the two ambient-time reads. The aggregator may only parse the
    // explicit instants it is given (`new Date(ms)`, `Date.parse`), never ask
    // the device what time it is.
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
      const summary = aggregateTimesheet(
        [
          {
            worker: { userId: "u1", name: "Avery" },
            startedAt: "2026-06-20T13:00:00Z", // Saturday — weekend Premium
            endedAt: "2026-06-20T21:00:00Z",
            capture: "live",
          },
        ],
        { timeZone: ET, isHoliday: NO_HOLIDAYS, range: JUNE_2026 },
      );
      expect(summary.grandTotal).toEqual({
        regularMinutes: 0,
        premiumMinutes: 480,
        totalMinutes: 480,
      });
    } finally {
      globalThis.Date = RealDate;
    }
  });

  it("never emits any latitude/longitude field, even when one is smuggled onto an input session (ADR 0019)", () => {
    const FORBIDDEN = /lat|lng|long|geo|coord/i;
    const findForbidden = (value: unknown, path = "$"): string[] => {
      if (Array.isArray(value)) {
        return value.flatMap((v, i) => findForbidden(v, `${path}[${i}]`));
      }
      if (value && typeof value === "object") {
        return Object.entries(value).flatMap(([k, v]) => {
          const hit = FORBIDDEN.test(k) ? [`${path}.${k}`] : [];
          return [...hit, ...findForbidden(v, `${path}.${k}`)];
        });
      }
      return [];
    };

    // A caller hands in a session decorated with location fields; the aggregator
    // must ignore them and emit nothing location-shaped.
    const tainted = {
      worker: { userId: "u1", name: "Avery", latitude: 40.7, longitude: -74 },
      startedAt: "2026-06-19T13:00:00Z",
      endedAt: "2026-06-19T21:00:00Z",
      capture: "live",
      geoCoordinates: { lat: 40.7, lng: -74 },
    } as unknown as Parameters<typeof aggregateTimesheet>[0][number];

    const summary = aggregateTimesheet([tainted], {
      timeZone: ET,
      isHoliday: NO_HOLIDAYS,
      range: JUNE_2026,
    });

    expect(findForbidden(summary)).toEqual([]);
  });
});
