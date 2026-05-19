import { describe, it, expect, vi } from "vitest";

// `getActiveOrganizationId` decodes a JWT off a user-session client; the
// Service client the tools run on has no session, so it is always mocked
// here. `create_alert`'s only safe org source is the job it references.
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn().mockResolvedValue(null),
}));

import { executeJarvisTool, type ToolExecutionContext } from "./tools";
import { fakeClient } from "@/lib/request-context/__test-utils__/request-context-fakes";

// Issue #120 — every Jarvis tool runs against the Service client, which
// bypasses row-level security, so each data query must scope to the caller's
// Active Organization itself. These tests seed two organizations and assert
// no tool ever surfaces or writes to the foreign one.

type Tables = Parameters<typeof fakeClient>[0]["tables"];

function contextWith(tables: Tables): ToolExecutionContext {
  return {
    userId: "user-1",
    userName: "Tester",
    userRole: "admin",
    orgId: "org-1",
    supabase: fakeClient({ tables }) as never,
  };
}

describe("executeJarvisTool — organization scoping (#120)", () => {
  it("get_job_details does not return a job from another organization", async () => {
    const ctx = contextWith({
      jobs: [{ id: "job-x", organization_id: "other-org", job_number: "1001" }],
    });

    const raw = await executeJarvisTool(
      "get_job_details",
      { job_id: "job-x" },
      ctx,
    );

    expect(JSON.parse(raw)).toEqual({ error: "Job not found" });
  });

  it("get_job_details returns a job that belongs to the caller's organization", async () => {
    const ctx = contextWith({
      jobs: [{ id: "job-1", organization_id: "org-1", job_number: "1001" }],
    });

    const raw = await executeJarvisTool(
      "get_job_details",
      { job_id: "job-1" },
      ctx,
    );

    expect(JSON.parse(raw)).toMatchObject({ id: "job-1", job_number: "1001" });
  });

  it("search_jobs returns only jobs in the caller's organization", async () => {
    const ctx = contextWith({
      jobs: [
        { id: "job-1", organization_id: "org-1", job_number: "1001" },
        { id: "job-2", organization_id: "other-org", job_number: "2002" },
      ],
    });

    const raw = await executeJarvisTool("search_jobs", {}, ctx);

    const result = JSON.parse(raw) as { jobs: { id: string }[]; total: number };
    expect(result.jobs.map((j) => j.id)).toEqual(["job-1"]);
    expect(result.total).toBe(1);
  });

  it("get_business_metrics counts jobs and revenue from the caller's organization only", async () => {
    const ctx = contextWith({
      jobs: [
        { id: "j1", organization_id: "org-1", status: "new" },
        { id: "j2", organization_id: "other-org", status: "new" },
        { id: "j3", organization_id: "other-org", status: "in_progress" },
      ],
      payments: [
        {
          job_id: "j1",
          organization_id: "org-1",
          amount: 100,
          source: "insurance",
          status: "received",
        },
        {
          job_id: "j2",
          organization_id: "other-org",
          amount: 999,
          source: "insurance",
          status: "received",
        },
      ],
    });

    const raw = await executeJarvisTool("get_business_metrics", {}, ctx);

    const result = JSON.parse(raw) as {
      active_jobs: number;
      revenue: { total: number };
    };
    expect(result.active_jobs).toBe(1);
    expect(result.revenue.total).toBe(100);
  });

  it("log_activity refuses to write to a job in another organization", async () => {
    const ctx = contextWith({
      jobs: [{ id: "job-x", organization_id: "other-org" }],
    });

    const raw = await executeJarvisTool(
      "log_activity",
      { job_id: "job-x", title: "Crossed a tenant boundary" },
      ctx,
    );

    expect(JSON.parse(raw)).toEqual({ error: "job not found" });
  });

  it("create_alert does not adopt the organization of a job in another tenant", async () => {
    // jarvis_alerts is seeded so the unscoped code path would *succeed* —
    // returning an alert_id for an alert written to other-org. Scoping must
    // turn that into a refusal instead.
    const ctx = contextWith({
      jobs: [{ id: "job-x", organization_id: "other-org" }],
      jarvis_alerts: [{ id: "alert-1" }],
    });

    const raw = await executeJarvisTool(
      "create_alert",
      {
        job_id: "job-x",
        message: "Follow up",
        due_date: "2026-06-01",
      },
      ctx,
    );

    // The foreign job's org must not become the alert's org; with no other
    // org source the alert is refused rather than written to other-org.
    const result = JSON.parse(raw) as { alert_id?: string; error?: string };
    expect(result.alert_id).toBeUndefined();
    expect(result.error).toBeDefined();
  });
});
