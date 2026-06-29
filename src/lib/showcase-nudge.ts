// #613 — Showcase: entity + builder (drafts).
//
// `completedJobsWithoutShowcase` is the pure selector behind the Marketing
// area's nudge: the recently-completed Jobs that do not yet have a Showcase,
// most-recently-completed first. It is intentionally just the filtering and
// ordering — the caller is responsible for fetching the Org's Jobs, the set of
// Job ids that already have a Showcase, and for supplying a `completedAt` proxy
// (Jobs carry no `completed_at`, so the route passes the Job's `updated_at`)
// and a fixed `now`, which keeps the recency math deterministic and testable.

const DAY_MS = 24 * 60 * 60 * 1000;

/** The window, in days, a completed Job stays in the nudge list. */
const DEFAULT_WINDOW_DAYS = 90;

/** The fields the nudge selector reads off a Job. */
export interface NudgeJob {
  id: string;
  /** The Job's status; only `"completed"` Jobs are eligible. */
  status: string;
  /** When the Job was (effectively) completed — the route passes `updated_at`. */
  completedAt: string;
}

export interface NudgeOptions {
  /** Fixed "now" the recency window is measured back from (ISO timestamp). */
  now: string;
  /** How far back a completed Job stays eligible. Defaults to 90 days. */
  withinDays?: number;
  /** Optional cap on the list length, keeping the most recent. */
  limit?: number;
}

/**
 * The completed Jobs that have no Showcase yet, most recently completed first.
 *
 * Generic over the Job row so the caller gets back the full rows it passed in
 * (the selector only reads {@link NudgeJob}'s fields).
 */
export function completedJobsWithoutShowcase<T extends NudgeJob>(
  jobs: T[],
  showcasedJobIds: Iterable<string>,
  options: NudgeOptions,
): T[] {
  const showcased = new Set(showcasedJobIds);
  const windowDays = options.withinDays ?? DEFAULT_WINDOW_DAYS;
  const cutoff = new Date(options.now).getTime() - windowDays * DAY_MS;
  const eligible = jobs
    .filter(
      (j) =>
        j.status === "completed" &&
        !showcased.has(j.id) &&
        new Date(j.completedAt).getTime() >= cutoff,
    )
    .sort(
      (a, b) =>
        new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
    );
  return options.limit === undefined
    ? eligible
    : eligible.slice(0, Math.max(0, options.limit));
}
