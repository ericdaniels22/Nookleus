// Lifetime-jobs rule from PRD #297 / slice C1 (#300).
//
// Two pure functions consumed by:
//   - the `GET /api/referral-partners` list endpoint (slice C1) for the
//     `job_count` on each row — the SQL computes the count, this module
//     is the unit-tested specification of *what the count means*;
//   - slice C2's "Jobs sent" section on the Referral Partner Worksheet,
//     which uses `listAttributed` to render the actual list.
//
// The trashed-job filter (`deleted_at IS NULL`) is the load-bearing rule.
// A Job that has been moved to Trash does NOT count toward its Partner's
// lifetime count — see PRD user-story #16.

import { describe, expect, it } from "vitest";

import { countAttributed, listAttributed } from "./jobs";

type J = {
  id: string;
  referral_partner_id: string | null;
  deleted_at: string | null;
  created_at: string;
};

describe("countAttributed", () => {
  it("returns 0 when the input list is empty", () => {
    expect(countAttributed([], "p-1")).toBe(0);
  });

  it("returns 0 when no job is attributed to the given partner", () => {
    const jobs: J[] = [
      { id: "j-1", referral_partner_id: "p-2", deleted_at: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "j-2", referral_partner_id: null,  deleted_at: null, created_at: "2026-01-02T00:00:00Z" },
    ];
    expect(countAttributed(jobs, "p-1")).toBe(0);
  });

  it("excludes trashed jobs from the count even when their FK matches", () => {
    const jobs: J[] = [
      { id: "j-1", referral_partner_id: "p-1", deleted_at: null,                      created_at: "2026-01-01T00:00:00Z" },
      { id: "j-2", referral_partner_id: "p-1", deleted_at: "2026-05-01T00:00:00Z",    created_at: "2026-01-02T00:00:00Z" },
      { id: "j-3", referral_partner_id: "p-1", deleted_at: null,                      created_at: "2026-01-03T00:00:00Z" },
    ];
    expect(countAttributed(jobs, "p-1")).toBe(2);
  });

  it("counts only the matching partner's non-trashed jobs in a mixed list", () => {
    const jobs: J[] = [
      { id: "j-1", referral_partner_id: "p-1", deleted_at: null,                   created_at: "2026-01-01T00:00:00Z" },
      { id: "j-2", referral_partner_id: "p-2", deleted_at: null,                   created_at: "2026-01-02T00:00:00Z" },
      { id: "j-3", referral_partner_id: "p-1", deleted_at: "2026-05-01T00:00:00Z", created_at: "2026-01-03T00:00:00Z" },
      { id: "j-4", referral_partner_id: null,  deleted_at: null,                   created_at: "2026-01-04T00:00:00Z" },
      { id: "j-5", referral_partner_id: "p-1", deleted_at: null,                   created_at: "2026-01-05T00:00:00Z" },
    ];
    expect(countAttributed(jobs, "p-1")).toBe(2);
  });
});

describe("listAttributed", () => {
  it("returns an empty list when no job is attributed to the partner", () => {
    const jobs: J[] = [
      { id: "j-1", referral_partner_id: "p-2", deleted_at: null, created_at: "2026-01-01T00:00:00Z" },
    ];
    expect(listAttributed(jobs, "p-1")).toEqual([]);
  });

  it("orders attributed jobs newest-first by created_at", () => {
    const oldest = { id: "j-1", referral_partner_id: "p-1", deleted_at: null, created_at: "2026-01-01T00:00:00Z" };
    const middle = { id: "j-2", referral_partner_id: "p-1", deleted_at: null, created_at: "2026-03-15T00:00:00Z" };
    const newest = { id: "j-3", referral_partner_id: "p-1", deleted_at: null, created_at: "2026-05-20T00:00:00Z" };
    // Feed in an out-of-order list to prove the function sorts.
    const out = listAttributed([middle, oldest, newest], "p-1");
    expect(out.map((j) => j.id)).toEqual(["j-3", "j-2", "j-1"]);
  });

  it("excludes trashed jobs from the list", () => {
    const live    = { id: "j-1", referral_partner_id: "p-1", deleted_at: null,                   created_at: "2026-01-01T00:00:00Z" };
    const trashed = { id: "j-2", referral_partner_id: "p-1", deleted_at: "2026-05-01T00:00:00Z", created_at: "2026-02-01T00:00:00Z" };
    expect(listAttributed([live, trashed], "p-1").map((j) => j.id)).toEqual(["j-1"]);
  });
});
