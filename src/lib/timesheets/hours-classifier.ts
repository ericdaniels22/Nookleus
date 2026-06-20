// src/lib/timesheets/hours-classifier.ts — the pure ADR-0020 hour classifier
// for the per-Job timesheet hours core (#703).
//
// Given one Time session (a clock-in instant and a clock-out instant, both
// ISO-8601 UTC) plus the Organization timezone and an "is this an observed
// federal holiday" predicate, it returns the session split into reason-labelled
// segments. ADR 0020 exactly:
//
//   Regular  = Monday–Friday, 7am–5pm, up to 8 hours per calendar day.
//   Premium  = everything else, at ONE rate (reasons label, never stack):
//                • before 7am or after 5pm on a weekday   → reason "evening"
//                • all hours on Saturday/Sunday           → reason "weekend"
//                • all hours on an observed federal holiday → reason "holiday"
//                • any hours past 8 in a calendar day      → reason "overtime"
//
// Every boundary — the 7am/5pm cutoffs, the day-of-week, the holiday lookup, the
// midnight split, and the >8h/day cap — is evaluated in the passed-in
// Organization timezone (`zonedParts`), never device-local `new Date()`. The
// thresholds are fixed business rules and live here, in one place (ADR 0020).
//
// No location (ADR 0019): no latitude/longitude is an input or an output.

import { zonedParts } from "./org-zone";
import type { CivilDate } from "./federal-holidays";

// Fixed ADR-0020 business rules (not parameters — they live in one place).
const REGULAR_START_HOUR = 7; // 7am
const REGULAR_END_HOUR = 17; // 5pm
const DAILY_REGULAR_CAP_MINUTES = 8 * 60; // 8 hours/calendar day

const MINUTE_MS = 60_000;

export type Tier = "regular" | "premium";
export type SegmentReason =
  | "regular"
  | "evening"
  | "weekend"
  | "holiday"
  | "overtime";

/** The span the classifier needs — just two UTC instants. */
export interface ClassifiableSession {
  startedAt: string; // ISO-8601 UTC
  endedAt: string; // ISO-8601 UTC
}

export interface HourSegment {
  date: string; // civil day "YYYY-MM-DD" in the org zone
  tier: Tier;
  reason: SegmentReason;
  minutes: number;
}

export interface ClassifyOptions {
  timeZone: string;
  // Injected so the rule owns no calendar (the aggregator wires the real one).
  isHoliday: (date: CivilDate) => boolean;
  // Regular minutes already counted per calendar day BEFORE this session, so the
  // daily 8h cap carries across a worker's earlier same-day sessions.
  priorRegularMinutesByDay?: Record<string, number>;
}

export interface ClassifiedSession {
  segments: HourSegment[];
  regularMinutes: number;
  premiumMinutes: number;
  // Prior + this session's regular minutes per day, for threading the daily cap.
  regularMinutesByDay: Record<string, number>;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function classifySession(
  session: ClassifiableSession,
  options: ClassifyOptions,
): ClassifiedSession {
  const { timeZone, isHoliday, priorRegularMinutesByDay = {} } = options;
  const startMs = Date.parse(session.startedAt);
  const endMs = Date.parse(session.endedAt);
  const regularMinutesByDay: Record<string, number> = {
    ...priorRegularMinutesByDay,
  };

  if (!(endMs > startMs)) {
    return {
      segments: [],
      regularMinutes: 0,
      premiumMinutes: 0,
      regularMinutesByDay,
    };
  }

  const segments: HourSegment[] = [];
  let regularMinutes = 0;
  let premiumMinutes = 0;

  // Walk the session minute by minute, resolving each minute's civil day and
  // wall-clock in the org zone. A minute changing civil day (the midnight split)
  // or class starts a new coalesced segment.
  for (let t = startMs; t < endMs; t += MINUTE_MS) {
    const sliceEnd = Math.min(t + MINUTE_MS, endMs);
    const minutes = (sliceEnd - t) / MINUTE_MS;
    const p = zonedParts(t, timeZone);
    const dayKey = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;

    let tier: Tier;
    let reason: SegmentReason;
    if (isHoliday({ year: p.year, month: p.month, day: p.day })) {
      tier = "premium";
      reason = "holiday";
    } else if (p.weekday === 0 || p.weekday === 6) {
      tier = "premium";
      reason = "weekend";
    } else if (p.hour < REGULAR_START_HOUR || p.hour >= REGULAR_END_HOUR) {
      tier = "premium";
      reason = "evening";
    } else {
      // Weekday business-hours minute: Regular until the day's 8h cap, then
      // Premium-overtime. Only these minutes consume the daily Regular budget.
      const used = regularMinutesByDay[dayKey] ?? 0;
      if (used < DAILY_REGULAR_CAP_MINUTES) {
        tier = "regular";
        reason = "regular";
        regularMinutesByDay[dayKey] = used + minutes;
      } else {
        tier = "premium";
        reason = "overtime";
      }
    }

    if (tier === "regular") regularMinutes += minutes;
    else premiumMinutes += minutes;

    const last = segments[segments.length - 1];
    if (
      last &&
      last.date === dayKey &&
      last.tier === tier &&
      last.reason === reason
    ) {
      last.minutes += minutes;
    } else {
      segments.push({ date: dayKey, tier, reason, minutes });
    }
  }

  return { segments, regularMinutes, premiumMinutes, regularMinutesByDay };
}
