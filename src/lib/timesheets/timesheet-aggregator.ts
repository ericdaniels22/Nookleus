// src/lib/timesheets/timesheet-aggregator.ts — the pure transform from a Job's
// Time sessions over a date range into the deliverable shape consumed by both
// the on-screen preview and the PDF renderer (#703, ADR 0019/0020).
//
// It drives the hour classifier (and, through the caller, the federal-holiday
// calendar) to split each session into Regular/Premium, groups the sessions by
// worker, and rolls them up into per-worker summaries with chronological detail
// rows plus grand totals. It performs no I/O, reads no ambient clock, and never
// accepts or emits latitude/longitude — timezone and holiday data come in as
// parameters.

import { zonedParts } from "./org-zone";
import { classifySession, type SegmentReason } from "./hours-classifier";
import type { CivilDate } from "./federal-holidays";

export type CaptureMarker = "live" | "hand";

/** The worker a Time session names: an app User (has an id) or an Off-app worker
 * (just a typed name, no record of its own). */
export interface TimesheetWorker {
  userId?: string;
  name: string;
}

export interface TimesheetSession {
  worker: TimesheetWorker;
  startedAt: string; // ISO-8601 UTC clock-in
  endedAt: string; // ISO-8601 UTC clock-out
  capture: CaptureMarker; // live clock vs hand-entered Correction
}

export interface AggregateOptions {
  timeZone: string;
  isHoliday: (date: CivilDate) => boolean;
  // The civil-day window (org zone) the timesheet covers, inclusive of both
  // ends, as "YYYY-MM-DD". A session belongs if its clock-in day is within it.
  range: { start: string; end: string };
}

export interface TimesheetDetailRow {
  worker: TimesheetWorker;
  date: string; // clock-in civil day "YYYY-MM-DD" in the org zone
  startedAt: string;
  endedAt: string;
  capture: CaptureMarker;
  regularMinutes: number;
  premiumMinutes: number;
  // Distinct Premium reasons in this session, in segment order ([] when none).
  premiumReasons: SegmentReason[];
}

export interface TimesheetWorkerSummary {
  worker: TimesheetWorker;
  regularMinutes: number;
  premiumMinutes: number;
  totalMinutes: number;
  rows: TimesheetDetailRow[];
}

export interface TimesheetTotals {
  regularMinutes: number;
  premiumMinutes: number;
  totalMinutes: number;
}

export interface TimesheetSummary {
  workers: TimesheetWorkerSummary[];
  grandTotal: TimesheetTotals;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// The civil day a session belongs to is the day it was clocked in, resolved in
// the org zone.
function clockInDay(startedAt: string, timeZone: string): string {
  const p = zonedParts(Date.parse(startedAt), timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function premiumReasonsOf(
  segments: { tier: string; reason: SegmentReason }[],
): SegmentReason[] {
  const seen = new Set<SegmentReason>();
  const reasons: SegmentReason[] = [];
  for (const seg of segments) {
    if (seg.tier === "premium" && !seen.has(seg.reason)) {
      seen.add(seg.reason);
      reasons.push(seg.reason);
    }
  }
  return reasons;
}

// A stable grouping key per worker: an app User by id, an Off-app worker by the
// typed name it carries (it has no record of its own).
function workerKey(worker: TimesheetWorker): string {
  return worker.userId !== undefined ? `u:${worker.userId}` : `n:${worker.name}`;
}

// Emit only the worker fields this module owns ({ userId, name }), never the
// caller's object by reference — so anything else smuggled onto an input (above
// all latitude/longitude, ADR 0019) cannot leak into the output.
function cleanWorker(worker: TimesheetWorker): TimesheetWorker {
  return { userId: worker.userId, name: worker.name };
}

export function aggregateTimesheet(
  sessions: TimesheetSession[],
  options: AggregateOptions,
): TimesheetSummary {
  const { timeZone, isHoliday, range } = options;

  // Keep only sessions whose clock-in day falls within the range (inclusive),
  // evaluated in the org zone — zero-padded "YYYY-MM-DD" compares lexically.
  const inRange = sessions.filter((s) => {
    const day = clockInDay(s.startedAt, timeZone);
    return day >= range.start && day <= range.end;
  });

  // Chronological by clock-in instant. This both orders the detail rows and, by
  // grouping in this order, orders workers by their earliest session.
  const ordered = [...inRange].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );

  const byWorker = new Map<string, TimesheetWorkerSummary>();
  // The daily 8h Regular cap is per worker, summed across that worker's sessions
  // within a calendar day. Carry each worker's running Regular-minutes-by-day
  // forward, so a later same-day session sees the budget the earlier ones spent.
  const regularByDayByWorker = new Map<string, Record<string, number>>();

  for (const s of ordered) {
    const key = workerKey(s.worker);
    const worker = cleanWorker(s.worker);
    const classified = classifySession(
      { startedAt: s.startedAt, endedAt: s.endedAt },
      {
        timeZone,
        isHoliday,
        priorRegularMinutesByDay: regularByDayByWorker.get(key) ?? {},
      },
    );
    regularByDayByWorker.set(key, classified.regularMinutesByDay);
    const row: TimesheetDetailRow = {
      worker,
      date: clockInDay(s.startedAt, timeZone),
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      capture: s.capture,
      regularMinutes: classified.regularMinutes,
      premiumMinutes: classified.premiumMinutes,
      premiumReasons: premiumReasonsOf(classified.segments),
    };

    let summary = byWorker.get(key);
    if (!summary) {
      summary = {
        worker,
        regularMinutes: 0,
        premiumMinutes: 0,
        totalMinutes: 0,
        rows: [],
      };
      byWorker.set(key, summary);
    }
    summary.rows.push(row);
    summary.regularMinutes += row.regularMinutes;
    summary.premiumMinutes += row.premiumMinutes;
    summary.totalMinutes += row.regularMinutes + row.premiumMinutes;
  }

  const workers = [...byWorker.values()];
  const grandTotal: TimesheetTotals = {
    regularMinutes: 0,
    premiumMinutes: 0,
    totalMinutes: 0,
  };
  for (const w of workers) {
    grandTotal.regularMinutes += w.regularMinutes;
    grandTotal.premiumMinutes += w.premiumMinutes;
    grandTotal.totalMinutes += w.totalMinutes;
  }

  return { workers, grandTotal };
}
