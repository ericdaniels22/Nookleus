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

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
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

describe("GET /api/email/attachments/[id] — gated on view_email (#105)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await GET(new Request("http://test"), paramsFor("att-1"));

    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks view_email", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
    });

    const res = await GET(new Request("http://test"), paramsFor("att-1"));

    expect(res.status).toBe(403);
  });

  it("passes the gate when the caller holds view_email — the handler runs", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: ["view_email"],
      }),
    });

    const res = await GET(new Request("http://test"), paramsFor("att-1"));

    // No attachment seeded, so the handler returns 404 — proving the gate
    // let the request through rather than rejecting it with 403.
    expect(res.status).toBe(404);
  });

  it("admins pass the gate without holding the key", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await GET(new Request("http://test"), paramsFor("att-1"));

    expect(res.status).not.toBe(403);
  });
});
