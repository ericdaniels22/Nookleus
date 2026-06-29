// POST /api/jobs/[id]/showcases — create the Job's one draft Showcase (#613).
// These tests pin the route's wiring: the admin-only gate (#613 AC: every
// Showcase surface is admin-only), the Job-visibility guard (no cross-org
// reference), forwarding the author + body to the create step, and mapping a
// one-per-Job conflict to 409. The create step's own behavior (photo sanitize,
// the insert) is covered in `src/lib/create-showcase.test.ts`, so here
// `createShowcaseDraft` is mocked — while keeping the real
// `ShowcaseAlreadyExistsError` so the route's `instanceof` mapping is exercised.

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
vi.mock("@/lib/create-showcase", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/create-showcase")>();
  return { ...actual, createShowcaseDraft: vi.fn() };
});

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  createShowcaseDraft,
  ShowcaseAlreadyExistsError,
} from "@/lib/create-showcase";
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

// An admin of the active org for whom the URL's Job (`job-1`) is visible.
function adminClient() {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "admin",
      extraTables: {
        jobs: [{ id: "job-1", organization_id: "org-1" }],
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createShowcaseDraft).mockResolvedValue({
    id: "sc-1",
  } as never);
});

describe("POST /api/jobs/[id]/showcases", () => {
  it("creates the draft Showcase (201) for an admin when the Job is visible", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminClient() as never,
    );

    const res = await POST(postBody({}), paramsFor("job-1"));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ showcase: { id: "sc-1" } });
    expect(createShowcaseDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        jobId: "job-1",
        createdBy: "user-1",
      }),
    );
  });

  it("returns 403 for a non-admin member, even one holding edit_jobs", async () => {
    // #613 AC: every Showcase surface is admin-only. Unlike the report routes
    // (gated on the edit_jobs permission), no permission grant substitutes for
    // the admin role here — a member with edit_jobs is still refused.
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["edit_jobs"],
        }),
      }) as never,
    );

    const res = await POST(postBody({}), paramsFor("job-1"));

    expect(res.status).toBe(403);
    expect(createShowcaseDraft).not.toHaveBeenCalled();
  });

  it("returns 404 without creating a Showcase when the Job is not visible to the caller's organization", async () => {
    // The URL job id must be validated under the caller's RLS-scoped client: a
    // cross-org or nonexistent job isn't visible, so the route 404s before any
    // Showcase is created — and the foreign and fake cases look identical.
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          // No `jobs` row: the job is not visible to this caller's org.
        }),
      }) as never,
    );

    const res = await POST(postBody({}), paramsFor("job-1"));

    expect(res.status).toBe(404);
    expect(createShowcaseDraft).not.toHaveBeenCalled();
  });

  it("maps a one-per-Job conflict to 409", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminClient() as never,
    );
    vi.mocked(createShowcaseDraft).mockRejectedValue(
      new ShowcaseAlreadyExistsError(),
    );

    const res = await POST(postBody({}), paramsFor("job-1"));

    expect(res.status).toBe(409);
  });
});
