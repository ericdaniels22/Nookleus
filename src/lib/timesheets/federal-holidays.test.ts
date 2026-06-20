// federal-holidays — a pure date predicate for "is this civil date an OBSERVED
// US federal holiday" (#703, ADR 0020). Eleven federal holidays, with the
// federal observed-date shift (a holiday on Saturday is observed the preceding
// Friday; on Sunday, the following Monday). Table-driven black-box tests in the
// style of role-defaults.test.ts. No zone, no clock, no location — a civil date
// in, a boolean out.

import { describe, it, expect } from "vitest";
import { isObservedFederalHoliday } from "./federal-holidays";

describe("isObservedFederalHoliday", () => {
  it("treats New Year's Day (Jan 1, on a weekday) as an observed holiday", () => {
    // 2025-01-01 is a Wednesday — observed on the day itself.
    expect(isObservedFederalHoliday({ year: 2025, month: 1, day: 1 })).toBe(
      true,
    );
  });

  it("returns false for an ordinary nearby weekday", () => {
    expect(isObservedFederalHoliday({ year: 2025, month: 1, day: 2 })).toBe(
      false,
    );
    // July 5 is not a holiday (the day after Independence Day, here a weekday).
    expect(isObservedFederalHoliday({ year: 2025, month: 7, day: 5 })).toBe(
      false,
    );
  });

  // The six floating Monday/Thursday holidays for 2025 (computed observed dates).
  const FLOATING_2025: Array<[string, number, number]> = [
    ["MLK Jr. Day (3rd Mon Jan)", 1, 20],
    ["Washington's Birthday (3rd Mon Feb)", 2, 17],
    ["Memorial Day (last Mon May)", 5, 26],
    ["Labor Day (1st Mon Sep)", 9, 1],
    ["Columbus Day (2nd Mon Oct)", 10, 13],
    ["Thanksgiving (4th Thu Nov)", 11, 27],
  ];
  it.each(FLOATING_2025)(
    "recognizes %s in 2025 as a holiday",
    (_label, month, day) => {
      expect(isObservedFederalHoliday({ year: 2025, month, day })).toBe(true);
    },
  );

  // The fixed-date holidays, in a year where each falls on a weekday (observed
  // on the day itself — no shift). New Year's Day is covered above.
  const FIXED_2025: Array<[string, number, number]> = [
    ["Juneteenth (Jun 19)", 6, 19],
    ["Independence Day (Jul 4)", 7, 4],
    ["Veterans Day (Nov 11)", 11, 11],
    ["Christmas (Dec 25)", 12, 25],
  ];
  it.each(FIXED_2025)(
    "recognizes %s in 2025 as a holiday",
    (_label, month, day) => {
      expect(isObservedFederalHoliday({ year: 2025, month, day })).toBe(true);
    },
  );

  it("does not treat the wrong Monday as a floating holiday", () => {
    // The 2nd Monday of January 2025 (the 13th) is not MLK Day (the 3rd, 20th).
    expect(isObservedFederalHoliday({ year: 2025, month: 1, day: 13 })).toBe(
      false,
    );
  });

  // Observed-date shifting: a fixed holiday on Saturday is observed the preceding
  // Friday; on Sunday, the following Monday. [label, year, month, day, expected].
  const SHIFTED: Array<[string, number, number, number, boolean]> = [
    // Independence Day 2026 falls on a Saturday → observed Friday Jul 3.
    ["Jul 3 2026 (observed)", 2026, 7, 3, true],
    ["Jul 4 2026 (actual Saturday, shifted away)", 2026, 7, 4, false],
    // Independence Day 2027 falls on a Sunday → observed Monday Jul 5.
    ["Jul 5 2027 (observed)", 2027, 7, 5, true],
    ["Jul 4 2027 (actual Sunday, shifted away)", 2027, 7, 4, false],
    // Christmas 2027 falls on a Saturday → observed Friday Dec 24.
    ["Dec 24 2027 (observed)", 2027, 12, 24, true],
    ["Dec 25 2027 (actual Saturday, shifted away)", 2027, 12, 25, false],
    // Christmas 2022 falls on a Sunday → observed Monday Dec 26.
    ["Dec 26 2022 (observed)", 2022, 12, 26, true],
    ["Dec 25 2022 (actual Sunday, shifted away)", 2022, 12, 25, false],
    // New Year's Day 2022 falls on a Saturday → observed the PRIOR Friday,
    // Dec 31 2021 (a cross-year shift).
    ["Dec 31 2021 (observed New Year of 2022)", 2021, 12, 31, true],
    ["Jan 1 2022 (actual Saturday, shifted away)", 2022, 1, 1, false],
    // New Year's Day 2023 falls on a Sunday → observed Monday Jan 2.
    ["Jan 2 2023 (observed)", 2023, 1, 2, true],
    ["Jan 1 2023 (actual Sunday, shifted away)", 2023, 1, 1, false],
  ];
  it.each(SHIFTED)("observed shift: %s", (_label, year, month, day, expected) => {
    expect(isObservedFederalHoliday({ year, month, day })).toBe(expected);
  });

  it("does not treat Juneteenth as a holiday before it became federal in 2021", () => {
    // Jun 19 2020 was a Friday (a weekday) but Juneteenth was not yet a federal
    // holiday, so it must read as an ordinary work day.
    expect(isObservedFederalHoliday({ year: 2020, month: 6, day: 19 })).toBe(
      false,
    );
    // From 2021 it counts: Jun 19 2021 fell on a Saturday → observed Friday 18th.
    expect(isObservedFederalHoliday({ year: 2021, month: 6, day: 18 })).toBe(
      true,
    );
  });
});
