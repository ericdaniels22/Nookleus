// PRD #304 — Nookleus Phone. Slice 4 (#308).
//
// POST /api/phone/messages/[id]/tag — tag (or re-tag) a message to a Job
// from the prompt-chips banner. Body: { jobId } or { jobId: null } to
// remove the tag. The caller's user_id is recorded in `tagged_by_user_id`.

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
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeServiceClient,
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function postReq(body: Record<string, unknown>) {
  return new Request("http://test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createServiceClient).mockReturnValue(
    fakeServiceClient({ tables: {} }) as never,
  );
});

describe("POST /api/phone/messages/[id]/tag", () => {
  it("returns 401 unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const res = await POST(postReq({ jobId: "job-1" }), params("m-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller lacks view_phone", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({ userId: "u-1", role: "crew_member", grants: [] }),
      }) as never,
    );
    const res = await POST(postReq({ jobId: "job-1" }), params("m-1"));
    expect(res.status).toBe(403);
  });

  it("returns 400 when jobId is undefined (missing)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({
          userId: "u-1",
          role: "crew_lead",
          grants: ["view_phone"],
        }),
      }) as never,
    );
    const res = await POST(postReq({}), params("m-1"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the message does not exist in the active org", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({
          userId: "u-1",
          role: "crew_lead",
          grants: ["view_phone"],
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({ tables: { phone_messages: [] } }) as never,
    );
    const res = await POST(postReq({ jobId: "job-1" }), params("m-1"));
    expect(res.status).toBe(404);
  });

  it("updates job_tag + tagged_by_user_id when jobId is provided", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({
          userId: "u-1",
          role: "crew_lead",
          grants: ["view_phone"],
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: {
          phone_messages: [
            {
              id: "m-1",
              organization_id: "org-1",
              job_tag: null,
              tagged_by_user_id: null,
            },
          ],
        },
      }) as never,
    );

    const res = await POST(postReq({ jobId: "job-1" }), params("m-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("accepts jobId: null to remove the tag", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({
          userId: "u-1",
          role: "crew_lead",
          grants: ["view_phone"],
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: {
          phone_messages: [
            {
              id: "m-1",
              organization_id: "org-1",
              job_tag: "job-old",
              tagged_by_user_id: null,
            },
          ],
        },
      }) as never,
    );

    const res = await POST(postReq({ jobId: null }), params("m-1"));
    expect(res.status).toBe(200);
  });
});
