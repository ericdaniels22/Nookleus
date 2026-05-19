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

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

function paramsFor(threadId: string) {
  return { params: Promise.resolve({ threadId }) };
}

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/email/thread/[threadId] — gated on view_email (#105)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await GET(new Request("http://test"), paramsFor("t-1"));

    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks view_email", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
    });

    const res = await GET(new Request("http://test"), paramsFor("t-1"));

    expect(res.status).toBe(403);
  });

  it("returns the thread when the caller holds view_email", async () => {
    authed({
      user: { id: "user-1" },
      tables: {
        ...memberTables({
          userId: "user-1",
          role: "crew_member",
          grants: ["view_email"],
        }),
        emails: [{ id: "e-1", thread_id: "t-1" }],
      },
    });

    const res = await GET(new Request("http://test"), paramsFor("t-1"));

    expect(res.status).toBe(200);
  });

  it("admins retain access without holding the key", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await GET(new Request("http://test"), paramsFor("t-1"));

    expect(res.status).toBe(200);
  });
});
