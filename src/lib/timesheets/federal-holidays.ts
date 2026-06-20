// src/lib/timesheets/federal-holidays.ts — a pure "is this an OBSERVED US
// federal holiday" predicate for the hours core (#703, ADR 0020).

export interface CivilDate {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

// Day-of-week for a civil date, computed in UTC so it never depends on the
// host's timezone (0=Sunday … 6=Saturday).
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// The day-of-month of the `n`-th `weekday` (0=Sun…6=Sat) in a month.
function nthWeekday(
  year: number,
  month: number,
  weekday: number,
  n: number,
): number {
  const firstDow = weekdayOf(year, month, 1);
  const offset = (weekday - firstDow + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

// The day-of-month of the LAST `weekday` in a month.
function lastWeekday(year: number, month: number, weekday: number): number {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = weekdayOf(year, month, daysInMonth);
  const offset = (lastDow - weekday + 7) % 7;
  return daysInMonth - offset;
}

// The six floating holidays, each pinned to an nth (or last) weekday of a month.
function floatingHolidayDays(year: number): Set<string> {
  const MON = 1;
  const THU = 4;
  return new Set([
    `1-${nthWeekday(year, 1, MON, 3)}`, // MLK Jr. Day — 3rd Mon Jan
    `2-${nthWeekday(year, 2, MON, 3)}`, // Washington's Birthday — 3rd Mon Feb
    `5-${lastWeekday(year, 5, MON)}`, // Memorial Day — last Mon May
    `9-${nthWeekday(year, 9, MON, 1)}`, // Labor Day — 1st Mon Sep
    `10-${nthWeekday(year, 10, MON, 2)}`, // Columbus Day — 2nd Mon Oct
    `11-${nthWeekday(year, 11, THU, 4)}`, // Thanksgiving — 4th Thu Nov
  ]);
}

// The fixed-date holidays as [month, day]: New Year's, Juneteenth, Independence
// Day, Veterans Day, Christmas. (Observed shifting is applied separately.)
const FIXED_HOLIDAYS: Array<[number, number]> = [
  [1, 1],
  [6, 19],
  [7, 4],
  [11, 11],
  [12, 25],
];

// Juneteenth National Independence Day became a federal holiday only in 2021;
// the same date in an earlier year is an ordinary work day.
const JUNETEENTH_FIRST_YEAR = 2021;

// The fixed holidays that actually applied in a given year.
function fixedHolidaysFor(year: number): Array<[number, number]> {
  return FIXED_HOLIDAYS.filter(
    ([m, d]) =>
      !(m === 6 && d === 19 && year < JUNETEENTH_FIRST_YEAR),
  );
}

// The federal observed date for a fixed holiday: a Saturday holiday is observed
// the preceding Friday, a Sunday holiday the following Monday. Computed in UTC
// so the day-of-month arithmetic rolls across month/year boundaries correctly
// (e.g. Jan 1 on a Saturday is observed the preceding Dec 31).
function observedDate(year: number, month: number, day: number): CivilDate {
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dow = dt.getUTCDay();
  if (dow === 6) dt.setUTCDate(dt.getUTCDate() - 1); // Saturday → Friday
  else if (dow === 0) dt.setUTCDate(dt.getUTCDate() + 1); // Sunday → Monday
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

/** True when `date` is an observed US federal holiday. */
export function isObservedFederalHoliday(date: CivilDate): boolean {
  const { year, month, day } = date;

  // Floating holidays never fall on a weekend, so they are never shifted.
  if (floatingHolidayDays(year).has(`${month}-${day}`)) return true;

  // A fixed holiday counts on its OBSERVED date, not its actual date. Gather
  // the observed dates that could land on `date`: every fixed holiday of this
  // year, plus next year's New Year's Day (which, when Jan 1 is a Saturday, is
  // observed on Dec 31 of THIS year).
  const observed: CivilDate[] = fixedHolidaysFor(year).map(([m, d]) =>
    observedDate(year, m, d),
  );
  observed.push(observedDate(year + 1, 1, 1));

  return observed.some(
    (o) => o.year === year && o.month === month && o.day === day,
  );
}
