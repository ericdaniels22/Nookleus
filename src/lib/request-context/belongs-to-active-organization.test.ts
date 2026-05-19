import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { belongsToActiveOrganization } from "./belongs-to-active-organization";
import { fakeClient } from "./__test-utils__/request-context-fakes";

// The active organization the guard is checked against, and a second
// organization standing in for "someone else's data".
const ACTIVE_ORG = "org-1";
const OTHER_ORG = "org-2";

// A Service-client fake seeded with whatever rows a test needs the guard to
// resolve through. The guard reads `jobs` (direct) and `job_activities`
// (indirect, via `job_id`); an unseeded table reads empty.
function client(tables: Record<string, Record<string, unknown>[]>): SupabaseClient {
  return fakeClient({ tables }) as unknown as SupabaseClient;
}

describe("belongsToActiveOrganization", () => {
  describe("direct locator (table + id)", () => {
    it("passes when the resource belongs to the active organization", async () => {
      const supabase = client({
        jobs: [{ id: "job-1", organization_id: ACTIVE_ORG }],
      });

      expect(
        await belongsToActiveOrganization(
          supabase,
          { table: "jobs", id: "job-1" },
          ACTIVE_ORG,
        ),
      ).toBe(true);
    });

    it("denies a resource that belongs to another organization", async () => {
      const supabase = client({
        jobs: [{ id: "job-1", organization_id: OTHER_ORG }],
      });

      expect(
        await belongsToActiveOrganization(
          supabase,
          { table: "jobs", id: "job-1" },
          ACTIVE_ORG,
        ),
      ).toBe(false);
    });

    it("denies a resource that does not exist", async () => {
      const supabase = client({ jobs: [] });

      expect(
        await belongsToActiveOrganization(
          supabase,
          { table: "jobs", id: "job-missing" },
          ACTIVE_ORG,
        ),
      ).toBe(false);
    });
  });

  describe("job locator ({ jobId } shorthand)", () => {
    it("passes for a job in the active organization", async () => {
      const supabase = client({
        jobs: [{ id: "job-1", organization_id: ACTIVE_ORG }],
      });

      expect(
        await belongsToActiveOrganization(
          supabase,
          { jobId: "job-1" },
          ACTIVE_ORG,
        ),
      ).toBe(true);
    });

    it("denies a job in another organization", async () => {
      const supabase = client({
        jobs: [{ id: "job-1", organization_id: OTHER_ORG }],
      });

      expect(
        await belongsToActiveOrganization(
          supabase,
          { jobId: "job-1" },
          ACTIVE_ORG,
        ),
      ).toBe(false);
    });

    it("denies a job id that does not exist", async () => {
      const supabase = client({ jobs: [] });

      expect(
        await belongsToActiveOrganization(
          supabase,
          { jobId: "job-missing" },
          ACTIVE_ORG,
        ),
      ).toBe(false);
    });
  });

  describe("indirect locator (resolved through a foreign key)", () => {
    it("passes when the activity's job belongs to the active organization", async () => {
      const supabase = client({
        job_activities: [{ id: "act-1", job_id: "job-1" }],
        jobs: [{ id: "job-1", organization_id: ACTIVE_ORG }],
      });

      expect(
        await belongsToActiveOrganization(
          supabase,
          { table: "job_activities", id: "act-1" },
          ACTIVE_ORG,
        ),
      ).toBe(true);
    });

    it("denies when the activity's job belongs to another organization", async () => {
      const supabase = client({
        job_activities: [{ id: "act-1", job_id: "job-1" }],
        jobs: [{ id: "job-1", organization_id: OTHER_ORG }],
      });

      expect(
        await belongsToActiveOrganization(
          supabase,
          { table: "job_activities", id: "act-1" },
          ACTIVE_ORG,
        ),
      ).toBe(false);
    });

    it("denies when the activity itself does not exist", async () => {
      const supabase = client({
        job_activities: [],
        jobs: [{ id: "job-1", organization_id: ACTIVE_ORG }],
      });

      expect(
        await belongsToActiveOrganization(
          supabase,
          { table: "job_activities", id: "act-missing" },
          ACTIVE_ORG,
        ),
      ).toBe(false);
    });

    it("denies when the chain breaks — the activity's job does not exist", async () => {
      const supabase = client({
        job_activities: [{ id: "act-1", job_id: "job-missing" }],
        jobs: [],
      });

      expect(
        await belongsToActiveOrganization(
          supabase,
          { table: "job_activities", id: "act-1" },
          ACTIVE_ORG,
        ),
      ).toBe(false);
    });
  });

  describe("guard rails", () => {
    it("denies when there is no active organization", async () => {
      const supabase = client({
        jobs: [{ id: "job-1", organization_id: ACTIVE_ORG }],
      });

      expect(
        await belongsToActiveOrganization(supabase, { jobId: "job-1" }, null),
      ).toBe(false);
    });

    it("throws for a table with no registered resolver", async () => {
      const supabase = client({});

      await expect(
        belongsToActiveOrganization(
          supabase,
          { table: "vendors", id: "vendor-1" },
          ACTIVE_ORG,
        ),
      ).rejects.toThrow(/no Organization resolver registered for table "vendors"/);
    });
  });
});
