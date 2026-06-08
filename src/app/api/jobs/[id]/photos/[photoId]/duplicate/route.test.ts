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

const paramsFor = { params: Promise.resolve({ id: "job-1", photoId: "p-1" }) };

type Row = Record<string, unknown>;

interface Recorders {
  copies: { bucket: string; from: string; to: string }[];
  rpcs: { fn: string; args: Record<string, unknown> }[];
}

// Build the authed-client fake the wrapper authenticates against, with the
// Storage `.copy()` and `.rpc()` surfaces this route needs recorded so a test
// can assert exactly what it copied and which RPC it called.
function mockCaller(opts: {
  user: { id: string } | null;
  grants?: string[];
  photos?: Row[];
  copyError?: { message: string } | null;
  duplicated?: Row;
}): Recorders {
  const rec: Recorders = { copies: [], rpcs: [] };
  const client = fakeUserClient({
    user: opts.user,
    tables: opts.user
      ? memberTables({
          userId: opts.user.id,
          role: "member",
          grants: opts.grants ?? [],
          extraTables: {
            photos:
              opts.photos ??
              [{ id: "p-1", job_id: "job-1", storage_path: "org-1/job-1/p-1.jpg" }],
          },
        })
      : undefined,
  });

  (client as unknown as { storage: unknown }).storage = {
    from(bucket: string) {
      return {
        async copy(from: string, to: string) {
          rec.copies.push({ bucket, from, to });
          return { data: opts.copyError ? null : { path: to }, error: opts.copyError ?? null };
        },
      };
    },
  };
  (client as unknown as { rpc: unknown }).rpc = async (
    fn: string,
    args: Record<string, unknown>,
  ) => {
    rec.rpcs.push({ fn, args });
    return {
      data: opts.duplicated ?? { id: "p-2", job_id: "job-1", storage_path: args.p_new_storage_path },
      error: null,
    };
  };

  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return rec;
}

function postRequest() {
  return new Request("http://test", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("POST /api/jobs/[id]/photos/[photoId]/duplicate (gated on edit_jobs)", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCaller({ user: null });
    const res = await POST(postRequest(), paramsFor);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds only view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["view_jobs"] });
    const res = await POST(postRequest(), paramsFor);
    expect(res.status).toBe(403);
  });

  it("copies the clean original to a fresh path and delegates the row insert to duplicate_photo", async () => {
    const rec = mockCaller({
      user: { id: "u1" },
      grants: ["edit_jobs"],
      // The source has been drawn on; the duplicate must copy the ORIGINAL,
      // never the annotation render.
      photos: [
        {
          id: "p-1",
          job_id: "job-1",
          storage_path: "org-1/job-1/p-1.jpg",
          annotated_path: "org-1/job-1/p-1-annotated.png",
        },
      ],
    });

    const res = await POST(postRequest(), paramsFor);

    expect(res.status).toBe(201);

    // Copied the clean original (storage_path), never the annotated render,
    // into the photos bucket at a fresh org/job-scoped path with the original's
    // extension.
    expect(rec.copies).toHaveLength(1);
    const copy = rec.copies[0];
    expect(copy.bucket).toBe("photos");
    expect(copy.from).toBe("org-1/job-1/p-1.jpg");
    expect(copy.to).not.toBe("org-1/job-1/p-1-annotated.png");
    expect(copy.to).toMatch(/^org-1\/job-1\/.+\.jpg$/);

    // Handed the SAME fresh path to the deep module, keyed by the source id.
    expect(rec.rpcs).toHaveLength(1);
    expect(rec.rpcs[0].fn).toBe("duplicate_photo");
    expect(rec.rpcs[0].args).toEqual({
      p_source_photo_id: "p-1",
      p_new_storage_path: copy.to,
    });

    // Answers with the new Photo row.
    expect(await res.json()).toMatchObject({ id: "p-2", job_id: "job-1" });
  });

  it("returns 404 and neither copies nor inserts when the photo is not in the Job", async () => {
    const rec = mockCaller({
      user: { id: "u1" },
      grants: ["edit_jobs"],
      photos: [
        { id: "p-1", job_id: "another-job", storage_path: "org-1/another/p-1.jpg" },
      ],
    });

    const res = await POST(postRequest(), paramsFor);

    expect(res.status).toBe(404);
    expect(rec.copies).toHaveLength(0);
    expect(rec.rpcs).toHaveLength(0);
  });
});
