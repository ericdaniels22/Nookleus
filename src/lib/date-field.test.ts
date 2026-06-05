import { format } from "date-fns";
import { describe, expect, it } from "vitest";

import {
  isValidPastDate,
  maskDateInput,
  parseDateOnly,
  parseMaskedDate,
} from "./date-field";

/** Run `fn` with `process.env.TZ` pinned, then restore it. Node reads TZ per
 *  Date operation, so this lets one test assert behavior in a specific zone. */
function withTimeZone<T>(tz: string, fn: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = previous;
  }
}

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
  // Regression for issue #444: `new Date("2026-06-05")` parses as UTC midnight,
  // which date-fns then renders as the previous day in negative-UTC (US) zones.
  it("renders the literal calendar day in US/Eastern", () => {
    withTimeZone("America/New_York", () => {
      expect(format(parseDateOnly("2026-06-05"), "MMM d, yyyy")).toBe(
        "Jun 5, 2026",
      );
    });
  });

  it("renders the literal calendar day in US/Pacific", () => {
    withTimeZone("America/Los_Angeles", () => {
      expect(format(parseDateOnly("2026-06-05"), "MMM d, yyyy")).toBe(
        "Jun 5, 2026",
      );
    });
  });

  it("pins the parts to the local calendar day regardless of zone", () => {
    withTimeZone("America/Los_Angeles", () => {
      const date = parseDateOnly("2026-06-05");
      expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([
        2026, 5, 5,
      ]);
    });
  });

  it("keeps the local calendar day when a time component is present", () => {
    withTimeZone("America/Los_Angeles", () => {
      const date = parseDateOnly("2026-06-05T23:30:00");
      expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([
        2026, 5, 5,
      ]);
    });
  });
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
