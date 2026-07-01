// POST /api/jobs/[id]/sketch/floors — add a Floor to a Job's Sketch (#865). These
// tests pin the route's wiring: the `edit_jobs` gate, the job-visibility guard
// (mirroring the rooms route's #446 fix — a caller can't add a Floor to a Job
// their org can't see), resolving the Job's Sketch server-side (the client never
// names the Sketch), and forwarding the name to the create step. The insert is
// covered in src/lib/sketch/create-floor.test.ts, so `createSketchFloor` is
// mocked here.

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
vi.mock("@/lib/sketch/create-floor", () => ({
  createSketchFloor: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { createSketchFloor } from "@/lib/sketch/create-floor";
import {
  fakeUserClient,
  memberTables,
} from "../../../../__test-utils__/request-context-fakes";

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

// A member with edit_jobs for whom the URL's Job (`job-1`) — and its Sketch —
// are visible in their Organization.
function authedClient() {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_jobs"],
      extraTables: {
        jobs: [{ id: "job-1", organization_id: "org-1" }],
        sketches: [{ id: "sketch-1", job_id: "job-1", organization_id: "org-1" }],
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createSketchFloor).mockResolvedValue({ id: "floor-2" } as never);
});

describe("POST /api/jobs/[id]/sketch/floors", () => {
  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await POST(postBody({ name: "Second Floor" }), paramsFor("job-1"));

    expect(res.status).toBe(403);
    expect(createSketchFloor).not.toHaveBeenCalled();
  });

  it("returns 404 without creating a Floor when the Job is not visible to the caller's org", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["edit_jobs"],
          // No `jobs` row: the job is not visible to this caller's org.
        }),
      }) as never,
    );

    const res = await POST(postBody({ name: "Second Floor" }), paramsFor("job-1"));

    expect(res.status).toBe(404);
    expect(createSketchFloor).not.toHaveBeenCalled();
  });

  it("creates the Floor (201) under the Job's Sketch, forwarding the name", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(authedClient() as never);

    const res = await POST(
      postBody({ name: "Detached Garage" }),
      paramsFor("job-1"),
    );

    expect(res.status).toBe(201);
    // The Sketch id is resolved from the Job server-side — the client never
    // names it — and the org comes from the request context.
    expect(createSketchFloor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        sketchId: "sketch-1",
        name: "Detached Garage",
      }),
    );
  });
});
