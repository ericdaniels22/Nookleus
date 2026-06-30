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
} from "../../../../__test-utils__/request-context-fakes";

const paramsFor = { params: Promise.resolve({ id: "job-1" }) };

function mockCaller(opts: {
  user: { id: string } | null;
  role?: string;
  grants?: string[];
}) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: opts.user,
      tables: opts.user
        ? memberTables({
            userId: opts.user.id,
            role: opts.role ?? "member",
            grants: opts.grants ?? [],
          })
        : undefined,
    }) as never,
  );
}

function urlRequest(body: unknown) {
  return new Request("http://test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// build30/job-files: large files upload directly to storage via a signed
// upload URL (the 4.5 MB serverless body limit can't carry a photo report).
describe("POST /api/jobs/[id]/files/upload-url (gated on edit_jobs)", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCaller({ user: null });
    const res = await POST(
      urlRequest({ files: [{ filename: "a.pdf" }] }),
      paramsFor,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds only view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["view_jobs"] });
    const res = await POST(
      urlRequest({ files: [{ filename: "a.pdf" }] }),
      paramsFor,
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when no files are supplied", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["edit_jobs"] });
    const res = await POST(urlRequest({ files: [] }), paramsFor);
    expect(res.status).toBe(400);
  });

  it("returns a signed upload URL + token per file, scoped to the job folder", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["edit_jobs"] });
    const res = await POST(
      urlRequest({
        files: [
          { filename: "report.pdf", contentType: "application/pdf", size: 99 },
          { filename: "sheet.csv", contentType: "text/csv", size: 12 },
        ],
      }),
      paramsFor,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploads).toHaveLength(2);
    for (const u of body.uploads) {
      expect(u.storagePath.startsWith("org-1/job-1/")).toBe(true);
      expect(typeof u.token).toBe("string");
      expect(typeof u.signedUrl).toBe("string");
    }
    // Paths are unique per file (UUID-prefixed) and preserve the filename.
    expect(body.uploads[0].storagePath.endsWith("-report.pdf")).toBe(true);
    expect(body.uploads[1].storagePath.endsWith("-sheet.csv")).toBe(true);
    expect(body.uploads[0].storagePath).not.toBe(body.uploads[1].storagePath);
  });
});
