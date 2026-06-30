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

import { GET, POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../__test-utils__/request-context-fakes";

const paramsFor = { params: Promise.resolve({ id: "job-1" }) };

function mockCaller(opts: {
  user: { id: string } | null;
  role?: string;
  grants?: string[];
  errorsByTable?: Record<string, { code?: string; message: string }>;
}) {
  const client = fakeUserClient({
    user: opts.user,
    tables: opts.user
      ? memberTables({
          userId: opts.user.id,
          role: opts.role ?? "member",
          grants: opts.grants ?? [],
          extraTables: {
            job_files: [
              { id: "f-1", organization_id: "org-1", job_id: "job-1" },
              { id: "f-2", organization_id: "org-1", job_id: "job-1" },
            ],
          },
        })
      : undefined,
    errorsByTable: opts.errorsByTable,
  });
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// #103 — job file reads require `view_jobs`, writes require `edit_jobs`.
describe("GET /api/jobs/[id]/files (gated on view_jobs, #103)", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCaller({ user: null });
    const res = await GET(new Request("http://test"), paramsFor);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: [] });
    const res = await GET(new Request("http://test"), paramsFor);
    expect(res.status).toBe(403);
  });

  it("lists the job's files for a member holding view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["view_jobs"] });
    const res = await GET(new Request("http://test"), paramsFor);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((f: { id: string }) => f.id)).toEqual(["f-1", "f-2"]);
  });

  it("lists the job's files for an admin without an explicit grant", async () => {
    mockCaller({ user: { id: "u1" }, role: "admin", grants: [] });
    const res = await GET(new Request("http://test"), paramsFor);
    expect(res.status).toBe(200);
  });
});

// build30/job-files: the upload itself goes direct-to-storage via a signed
// URL; POST now only REGISTERS the already-uploaded objects (JSON metadata),
// so a multi-megabyte photo report never streams through this handler.
describe("POST /api/jobs/[id]/files register contract (gated on edit_jobs)", () => {
  function registerRequest(body: unknown) {
    return new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const validEntry = {
    filename: "report.pdf",
    storagePath: "org-1/job-1/abc-report.pdf",
    size: 99,
    mimeType: "application/pdf",
  };

  it("returns 401 when unauthenticated", async () => {
    mockCaller({ user: null });
    const res = await POST(registerRequest({ files: [validEntry] }), paramsFor);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds only view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["view_jobs"] });
    const res = await POST(registerRequest({ files: [validEntry] }), paramsFor);
    expect(res.status).toBe(403);
  });

  it("returns 400 when no files are supplied", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["edit_jobs"] });
    const res = await POST(registerRequest({ files: [] }), paramsFor);
    expect(res.status).toBe(400);
  });

  it("inserts a job_files row for each registered upload", async () => {
    const client = mockCaller({ user: { id: "u1" }, grants: ["edit_jobs"] });
    const res = await POST(registerRequest({ files: [validEntry] }), paramsFor);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.failed).toEqual([]);
    expect(body.succeeded).toHaveLength(1);

    const insert = client.__mutations.find(
      (m) => m.table === "job_files" && m.op === "insert",
    );
    expect(insert?.payload).toMatchObject({
      organization_id: "org-1",
      job_id: "job-1",
      filename: "report.pdf",
      storage_path: "org-1/job-1/abc-report.pdf",
      size_bytes: 99,
      mime_type: "application/pdf",
    });
  });

  it("rejects a storagePath outside the caller's org/job folder without inserting", async () => {
    const client = mockCaller({ user: { id: "u1" }, grants: ["edit_jobs"] });
    const res = await POST(
      registerRequest({
        files: [
          {
            filename: "evil.pdf",
            storagePath: "org-2/job-1/abc-evil.pdf",
            size: 1,
            mimeType: "application/pdf",
          },
        ],
      }),
      paramsFor,
    );
    // All entries rejected → 500; nothing written.
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.succeeded).toEqual([]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].filename).toBe("evil.pdf");
    expect(
      client.__mutations.some((m) => m.table === "job_files" && m.op === "insert"),
    ).toBe(false);
  });
});
