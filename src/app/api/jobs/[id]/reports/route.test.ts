// POST /api/jobs/[id]/reports — create a draft Photo Report from the Job Photos
// tab's "Create report" action (#400). These tests pin the route's wiring: the
// `edit_jobs` gate, the preparer-name lookup, and (the #405 change) forwarding
// an optional `templateId` from the body to the create step. The create step's
// own behavior — numbering, template seeding, photo ownership — is covered in
// `src/lib/photo-reports.test.ts`, so here `createPhotoReportDraft` is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));
vi.mock("@/lib/photo-reports", () => ({
  createPhotoReportDraft: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { createPhotoReportDraft } from "@/lib/photo-reports";
import {
  fakeUserClient,
  memberTables,
} from "../../../__test-utils__/request-context-fakes";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postBody(body: unknown) {
  return new Request("http://test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A caller who is a member with edit_jobs, whose user_profiles row carries a
// display name (the route stamps this into the report's "Prepared by"), and for
// whom the URL's Job (`job-1`) is visible in their Organization — the route now
// verifies job visibility before creating a report (#446).
function authedClient() {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_jobs"],
      extraTables: {
        user_profiles: [{ id: "user-1", full_name: "Eric Daniels" }],
        jobs: [{ id: "job-1", organization_id: "org-1" }],
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createPhotoReportDraft).mockResolvedValue({
    id: "report-1",
  } as never);
});

describe("POST /api/jobs/[id]/reports", () => {
  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await POST(postBody({ photoIds: ["p1"] }), paramsFor("job-1"));

    expect(res.status).toBe(403);
    expect(createPhotoReportDraft).not.toHaveBeenCalled();
  });

  it("returns 404 without creating a report when the Job is not visible to the caller's organization", async () => {
    // Issue #446: the URL job id was used unvalidated, so a caller in org A
    // could create a report referencing org B's job (or a bogus id). Under the
    // caller's RLS-scoped client a cross-org or nonexistent job simply isn't
    // visible, so the route must 404 *before* any report is created — and the
    // cross-org and nonexistent cases must look identical (no existence oracle
    // distinguishing a real-but-foreign id from a fake one).
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["edit_jobs"],
          extraTables: {
            user_profiles: [{ id: "user-1", full_name: "Eric Daniels" }],
            // No `jobs` row: the job is not visible to this caller's org.
          },
        }),
      }) as never,
    );

    const res = await POST(postBody({ photoIds: ["p1"] }), paramsFor("job-1"));

    expect(res.status).toBe(404);
    expect(createPhotoReportDraft).not.toHaveBeenCalled();
  });

  it("creates the report (201) when the Job is visible to the caller's organization", async () => {
    // AC #3 (#446): the visibility guard must reject only foreign/nonexistent
    // jobs — a job the caller can legitimately see still creates normally and
    // forwards the URL job id to the create step.
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await POST(
      postBody({ photoIds: ["p1", "p2"] }),
      paramsFor("job-1"),
    );

    expect(res.status).toBe(201);
    expect(createPhotoReportDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobId: "job-1", organizationId: "org-1" }),
    );
  });

  it("forwards an explicit templateId to the create step", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await POST(
      postBody({ photoIds: ["p1", "p2"], templateId: "tmpl-1" }),
      paramsFor("job-1"),
    );

    expect(res.status).toBe(201);
    expect(createPhotoReportDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        jobId: "job-1",
        preparerName: "Eric Daniels",
        photoIds: ["p1", "p2"],
        templateId: "tmpl-1",
      }),
    );
  });

  it("passes a null templateId through when the body omits one", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await POST(postBody({ photoIds: ["p1"] }), paramsFor("job-1"));

    expect(res.status).toBe(201);
    expect(createPhotoReportDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ templateId: null }),
    );
  });
});
