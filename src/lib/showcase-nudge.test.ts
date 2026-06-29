import { describe, it, expect } from "vitest";
import {
  completedJobsWithoutShowcase,
  type NudgeJob,
} from "./showcase-nudge";

// #613 — the Marketing area nudges the admin with recently-completed Jobs that
// do not yet have a Showcase. This pure selector is that list. Jobs carry no
// `completed_at` column, so the caller supplies a `completedAt` proxy (the
// route passes the Job's `updated_at`) and a fixed `now`, keeping the date math
// deterministic and testable.

function job(over: Partial<NudgeJob> & Pick<NudgeJob, "id">): NudgeJob {
  return {
    status: "completed",
    completedAt: "2026-06-20T00:00:00Z",
    ...over,
  };
}

const NOW = "2026-06-28T00:00:00Z";

describe("completedJobsWithoutShowcase", () => {
  it("lists completed jobs with no showcase, most recently completed first", () => {
    const jobs = [
      job({ id: "older", completedAt: "2026-06-01T00:00:00Z" }),
      job({ id: "newer", completedAt: "2026-06-20T00:00:00Z" }),
    ];

    const result = completedJobsWithoutShowcase(jobs, [], { now: NOW });

    expect(result.map((j) => j.id)).toEqual(["newer", "older"]);
  });

  it("excludes jobs that already have a showcase", () => {
    const jobs = [
      job({ id: "has-one" }),
      job({ id: "needs-one" }),
    ];

    const result = completedJobsWithoutShowcase(jobs, ["has-one"], { now: NOW });

    expect(result.map((j) => j.id)).toEqual(["needs-one"]);
  });

  it("excludes jobs that are not completed (in-progress, cancelled, etc.)", () => {
    const jobs = [
      job({ id: "done", status: "completed" }),
      job({ id: "wip", status: "in_progress" }),
      job({ id: "scrapped", status: "cancelled" }),
      job({ id: "awaiting-bill", status: "pending_invoice" }),
    ];

    const result = completedJobsWithoutShowcase(jobs, [], { now: NOW });

    expect(result.map((j) => j.id)).toEqual(["done"]);
  });

  it("excludes jobs completed before the recency window (default 90 days)", () => {
    const jobs = [
      job({ id: "recent", completedAt: "2026-06-01T00:00:00Z" }),
      job({ id: "stale", completedAt: "2026-01-01T00:00:00Z" }), // > 90d before NOW
    ];

    const result = completedJobsWithoutShowcase(jobs, [], { now: NOW });

    expect(result.map((j) => j.id)).toEqual(["recent"]);
  });

  it("honors a custom recency window", () => {
    const jobs = [
      job({ id: "within", completedAt: "2026-06-25T00:00:00Z" }), // 3d before NOW
      job({ id: "outside", completedAt: "2026-06-20T00:00:00Z" }), // 8d before NOW
    ];

    const result = completedJobsWithoutShowcase(jobs, [], {
      now: NOW,
      withinDays: 7,
    });

    expect(result.map((j) => j.id)).toEqual(["within"]);
  });

  it("caps the list at the provided limit, keeping the most recent", () => {
    const jobs = [
      job({ id: "a", completedAt: "2026-06-01T00:00:00Z" }),
      job({ id: "b", completedAt: "2026-06-20T00:00:00Z" }),
      job({ id: "c", completedAt: "2026-06-10T00:00:00Z" }),
    ];

    const result = completedJobsWithoutShowcase(jobs, [], {
      now: NOW,
      limit: 2,
    });

    expect(result.map((j) => j.id)).toEqual(["b", "c"]);
  });
});
