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

import { DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../../__test-utils__/request-context-fakes";

const paramsFor = { params: Promise.resolve({ id: "job-1" }) };

type Row = Record<string, unknown>;

// Returns the recorded storage removals so a test can assert exactly which
// objects the route deleted.
function mockCaller(opts: {
  user: { id: string } | null;
  role?: string;
  grants?: string[];
  photos?: Row[];
}) {
  const removals: { bucket: string; paths: string[] }[] = [];
  const client = fakeUserClient({
    user: opts.user,
    tables: opts.user
      ? memberTables({
          userId: opts.user.id,
          role: opts.role ?? "member",
          grants: opts.grants ?? [],
          extraTables: {
            photos: opts.photos ?? [
              { id: "p-1", job_id: "job-1", storage_path: "org-1/job-1/p-1.jpg" },
            ],
          },
        })
      : undefined,
  });
  // The bulk route removes storage objects on the authed (user) client; the
  // shared fake echoes paths but doesn't record them, so capture them here.
  (client as unknown as { storage: unknown }).storage = {
    from(bucket: string) {
      return {
        async remove(paths: string[]) {
          removals.push({ bucket, paths });
          return { data: paths.map((name) => ({ name })), error: null };
        },
      };
    },
  };
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return removals;
}

function deleteRequest() {
  return new Request("http://test", {
    method: "DELETE",
    body: JSON.stringify({ photoIds: ["p-1"] }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// #103 — bulk photo delete requires `edit_jobs`.
describe("DELETE /api/jobs/[id]/photos/bulk (gated on edit_jobs, #103)", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCaller({ user: null });
    const res = await DELETE(deleteRequest(), paramsFor);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds only view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["view_jobs"] });
    const res = await DELETE(deleteRequest(), paramsFor);
    expect(res.status).toBe(403);
  });

  it("bulk-deletes the photos for a member holding edit_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["edit_jobs"] });
    const res = await DELETE(deleteRequest(), paramsFor);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });
  });

  it("removes the photo's original, annotated, and derived -original objects but not any legacy thumbnail_path (#411)", async () => {
    const removals = mockCaller({
      user: { id: "u1" },
      grants: ["edit_jobs"],
      photos: [
        {
          id: "p-1",
          job_id: "job-1",
          storage_path: "org-1/job-1/p-1.jpg",
          annotated_path: "org-1/job-1/p-1-annot.jpg",
          // Dead column (#411): even a non-null value must not be deleted.
          thumbnail_path: "org-1/job-1/p-1-thumb.jpg",
        },
      ],
    });

    const res = await DELETE(deleteRequest(), paramsFor);

    expect(res.status).toBe(200);
    expect(removals).toEqual([
      {
        bucket: "photos",
        paths: [
          "org-1/job-1/p-1.jpg",
          "org-1/job-1/p-1-annot.jpg",
          "org-1/job-1/p-1-original.jpg",
        ],
      },
    ]);
  });
});
