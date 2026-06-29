// POST /api/jobs/[id]/showcases/[showcaseId]/delete — soft-delete a Showcase
// into the recoverable trash (#613, "delete & start over"). These tests pin the
// admin-only gate, that the handler stamps deleted_at, and the (id, job_id,
// active) tenancy scoping. Trashing frees the one-live-per-Job slot so a fresh
// Showcase can be created for the Job.

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

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../../../__test-utils__/request-context-fakes";

function paramsFor(id: string, showcaseId: string) {
  return { params: Promise.resolve({ id, showcaseId }) };
}

function adminClient(showcases: Record<string, unknown>[]) {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "admin",
      extraTables: { showcases },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("POST /api/jobs/[id]/showcases/[showcaseId]/delete", () => {
  it("stamps deleted_at for an admin", async () => {
    const client = adminClient([
      { id: "sc-1", job_id: "job-1", deleted_at: null },
    ]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(
      new Request("http://test"),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.__mutations).toContainEqual(
      expect.objectContaining({
        table: "showcases",
        op: "update",
        payload: { deleted_at: expect.any(String) },
      }),
    );
  });

  it("returns 403 for a non-admin member, even one holding edit_jobs", async () => {
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

    const res = await POST(
      new Request("http://test"),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 (not a re-stamp) when the Showcase is already trashed", async () => {
    const client = adminClient([
      { id: "sc-1", job_id: "job-1", deleted_at: "2026-01-01T00:00:00Z" },
    ]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(
      new Request("http://test"),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 (a no-op) for a live Showcase that belongs to a different Job", async () => {
    const client = adminClient([
      { id: "sc-1", job_id: "job-2", deleted_at: null },
    ]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(
      new Request("http://test"),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(404);
  });
});
