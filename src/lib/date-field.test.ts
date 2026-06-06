import { afterAll, describe, expect, it } from "vitest";
import { format } from "date-fns";

import { isValidPastDate, maskDateInput, parseDateOnly, parseMaskedDate } from "./date-field";

describe("maskDateInput", () => {
  it("formats eight digits into MM/DD/YYYY", () => {
    expect(maskDateInput("12252024")).toBe("12/25/2024");
  });

  it("leaves a one-or-two-digit month bare, with no trailing slash", () => {
    expect(maskDateInput("1")).toBe("1");
    expect(maskDateInput("12")).toBe("12");
  });

  it("opens the day block once the month is complete", () => {
    expect(maskDateInput("123")).toBe("12/3");
    expect(maskDateInput("1225")).toBe("12/25");
  });

  it("opens the year block once the day is complete", () => {
    expect(maskDateInput("12252")).toBe("12/25/2");
  });

  it("strips separators so an already-masked value re-masks unchanged", () => {
    expect(maskDateInput("12/25/2024")).toBe("12/25/2024");
  });

  it("returns an empty string for empty input", () => {
    expect(maskDateInput("")).toBe("");
  });

  it("ignores digits typed past the eighth", () => {
    expect(maskDateInput("122520249999")).toBe("12/25/2024");
  });
});

describe("parseMaskedDate", () => {
  it("parses a complete MM/DD/YYYY string into a Date", () => {
    expect(parseMaskedDate("12/25/2024")).toEqual(new Date(2024, 11, 25));
  });

  it("returns null for an incomplete string", () => {
    expect(parseMaskedDate("12/25")).toBeNull();
    expect(parseMaskedDate("")).toBeNull();
  });

  it("returns null for a non-existent calendar date", () => {
    expect(parseMaskedDate("02/30/2024")).toBeNull();
    expect(parseMaskedDate("13/01/2024")).toBeNull();
  });
});

describe("parseDateOnly", () => {
  it("returns a Date whose local Y/M/D equal the YYYY-MM-DD parts", () => {
    const d = parseDateOnly("2026-06-05");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June is month index 5
    expect(d.getDate()).toBe(5);
  });
});

// Issue #444: the Overview rendered report_date a day early in US (UTC-minus)
// timezones. These pin the exact acceptance criteria across both US zones named
// in the issue. The first assertion in each case is a guard: it confirms the TZ
// override is live and the off-by-one is genuinely reproducible here, so the
// second assertion is a meaningful regression test rather than a no-op.
describe("parseDateOnly across US timezones (issue #444)", () => {
  const originalTz = process.env.TZ;
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  for (const tz of ["America/New_York", "America/Los_Angeles"]) {
    it(`renders "Jun 5, 2026" for 2026-06-05 in ${tz}`, () => {
      process.env.TZ = tz;
      // The bug: a naive UTC parse renders the previous calendar day here.
      expect(format(new Date("2026-06-05"), "MMM d, yyyy")).toBe("Jun 4, 2026");
      // The fix: parseDateOnly preserves the day the user set.
      expect(format(parseDateOnly("2026-06-05"), "MMM d, yyyy")).toBe("Jun 5, 2026");
    });
  }
});

describe("isValidPastDate", () => {
  it("is true for a complete, real, past date", () => {
    expect(isValidPastDate("01/15/2020")).toBe(true);
  });

  it("is false for a future date", () => {
    const nextYear = new Date().getFullYear() + 1;
    expect(isValidPastDate(`06/15/${nextYear}`)).toBe(false);
  });

  it("is true for today (an incident can have happened today)", () => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    expect(isValidPastDate(`${mm}/${dd}/${now.getFullYear()}`)).toBe(true);
  });

  it("is false for an incomplete or non-existent date", () => {
    expect(isValidPastDate("12/25")).toBe(false);
    expect(isValidPastDate("02/30/2020")).toBe(false);
    expect(isValidPastDate("")).toBe(false);
  });
});
