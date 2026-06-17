import { describe, it, expect, vi, beforeEach } from "vitest";

// The wrapper authenticates against the User client and resolves the Active
// Organization from the JWT claim; the route's org-scoping guard reads the
// Job with the Service client. We mock both, plus the dispatcher itself — the
// route's job is auth + tenant-scoping + delegation, and the dispatcher has
// its own behavior tests.
vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));
vi.mock("@/lib/notifications/dispatch-new-intake", () => ({
  dispatchNewIntakeNotifications: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { dispatchNewIntakeNotifications } from "@/lib/notifications/dispatch-new-intake";
import {
  fakeUserClient,
  fakeServiceClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

function postJson(body: unknown) {
  return new Request("http://test/api/intake/notify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("POST /api/intake/notify", () => {
  it("dispatches new-intake notifications for a Job in the caller's Active Organization", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: { jobs: [{ id: "job-1", organization_id: "org-1" }] },
      }) as never,
    );

    const res = await POST(postJson({ jobId: "job-1" }), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(dispatchNewIntakeNotifications).toHaveBeenCalledWith({
      jobId: "job-1",
      submitterUserId: "user-1",
    });
  });

  it("returns 401 and does not dispatch when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(fakeServiceClient({}) as never);

    const res = await POST(postJson({ jobId: "job-1" }), { params: Promise.resolve({}) });

    expect(res.status).toBe(401);
    expect(dispatchNewIntakeNotifications).not.toHaveBeenCalled();
  });

  it("returns 404 and does not dispatch for a Job in another Organization", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        // job-2 belongs to org-2; the caller's Active Organization is org-1.
        tables: { jobs: [{ id: "job-2", organization_id: "org-2" }] },
      }) as never,
    );

    const res = await POST(postJson({ jobId: "job-2" }), { params: Promise.resolve({}) });

    expect(res.status).toBe(404);
    expect(dispatchNewIntakeNotifications).not.toHaveBeenCalled();
  });

  it("returns 404 and does not dispatch for a Job that does not exist", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({ tables: { jobs: [] } }) as never,
    );

    const res = await POST(postJson({ jobId: "job-missing" }), { params: Promise.resolve({}) });

    expect(res.status).toBe(404);
    expect(dispatchNewIntakeNotifications).not.toHaveBeenCalled();
  });

  it("returns 400 and does not dispatch when jobId is missing from the body", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(fakeServiceClient({}) as never);

    const res = await POST(postJson({}), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    expect(dispatchNewIntakeNotifications).not.toHaveBeenCalled();
  });
});
