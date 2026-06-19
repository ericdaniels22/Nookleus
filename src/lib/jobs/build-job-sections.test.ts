// Issue #723 — Jobs page stage-grouped sections.
//
// `buildJobSections` is the pure sort-and-group function behind the Jobs page's
// stage sections. It groups Jobs by their frozen status key into the page's
// display order — Active → Lead → Collections → Closed → Lost — newest-first
// within each section, sourcing each section's label/color/icon from the #720
// status-presentation module (the single source of truth, ADR 0022).
//
// Note: the page's section order is Active-first (work-priority), which is
// intentionally NOT the module's lifecycle sortRank (Lead-first). Emergency
// pinning (#726) and the hide-Closed/Lost toggle (#728) are separate slices.

import { describe, expect, it } from "vitest";
import type { Job } from "@/lib/types";
import { buildJobSections, countOpenJobs } from "./build-job-sections";

function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    job_number: "J-0001",
    contact_id: "c-1",
    status: "new",
    urgency: "scheduled",
    damage_type: "water",
    damage_source: null,
    property_address: "1 Test St",
    property_type: "single_family",
    property_sqft: null,
    property_stories: null,
    affected_areas: null,
    insurance_company: null,
    insurance_contact_id: null,
    claim_number: null,
    policy_number: null,
    payer_type: null,
    date_of_loss: null,
    deductible: null,
    estimated_crew_labor_cost: null,
    hoa_name: null,
    hoa_contact_name: null,
    hoa_contact_phone: null,
    hoa_contact_email: null,
    access_notes: null,
    cover_photo_id: null,
    created_at: "2026-05-27T10:00:00Z",
    ...over,
  } as Job;
}

describe("buildJobSections", () => {
  it("groups Jobs into stage sections ordered Active → Lead → Collections → Closed → Lost", () => {
    const jobs = [
      makeJob({ id: "lead", status: "new" }),
      makeJob({ id: "active", status: "in_progress" }),
      makeJob({ id: "collections", status: "pending_invoice" }),
      makeJob({ id: "closed", status: "completed" }),
      makeJob({ id: "lost", status: "cancelled" }),
    ];

    const sections = buildJobSections(jobs);

    expect(sections.map((s) => s.key)).toEqual([
      "in_progress",
      "new",
      "pending_invoice",
      "completed",
      "cancelled",
    ]);
  });

  it("counts the Jobs in each section", () => {
    const jobs = [
      makeJob({ id: "a1", status: "in_progress" }),
      makeJob({ id: "a2", status: "in_progress" }),
      makeJob({ id: "l1", status: "new" }),
    ];

    const sections = buildJobSections(jobs);
    const active = sections.find((s) => s.key === "in_progress");
    const lead = sections.find((s) => s.key === "new");

    expect(active?.count).toBe(2);
    expect(lead?.count).toBe(1);
  });

  it("orders Jobs newest-first within a section", () => {
    const jobs = [
      makeJob({ id: "older", status: "in_progress", created_at: "2026-05-01T00:00:00Z" }),
      makeJob({ id: "newest", status: "in_progress", created_at: "2026-05-30T00:00:00Z" }),
      makeJob({ id: "middle", status: "in_progress", created_at: "2026-05-15T00:00:00Z" }),
    ];

    const sections = buildJobSections(jobs);
    const active = sections.find((s) => s.key === "in_progress");

    expect(active?.jobs.map((j) => j.id)).toEqual(["newest", "middle", "older"]);
  });

  it("labels and colors each section from the status-presentation module", () => {
    const sections = buildJobSections([
      makeJob({ id: "a", status: "in_progress" }),
      makeJob({ id: "x", status: "cancelled" }),
    ]);
    const active = sections.find((s) => s.key === "in_progress");
    const lost = sections.find((s) => s.key === "cancelled");

    expect(active?.presentation.label).toBe("Active");
    expect(active?.presentation.accentColor).toBe("#0E9F6E");
    // Lost is visually distinct from Closed's grey (the point of #720).
    expect(lost?.presentation.label).toBe("Lost 😢");
    expect(lost?.presentation.accentColor).toBe("#E44B4A");
  });

  it("returns no sections for an empty Job list", () => {
    expect(buildJobSections([])).toEqual([]);
  });

  it("omits stages that hold no Jobs", () => {
    const sections = buildJobSections([
      makeJob({ id: "a", status: "in_progress" }),
      makeJob({ id: "l", status: "new" }),
    ]);
    // Only Active and Lead are populated — Collections/Closed/Lost are hidden.
    expect(sections.map((s) => s.key)).toEqual(["in_progress", "new"]);
  });
});

describe("countOpenJobs", () => {
  it("counts only the open stages — Lead + Active + Collections", () => {
    const jobs = [
      makeJob({ id: "a1", status: "in_progress" }),
      makeJob({ id: "a2", status: "in_progress" }),
      makeJob({ id: "l1", status: "new" }),
      makeJob({ id: "c1", status: "pending_invoice" }),
      makeJob({ id: "x1", status: "completed" }),
      makeJob({ id: "x2", status: "cancelled" }),
    ];

    expect(countOpenJobs(jobs)).toBe(4);
  });
});
