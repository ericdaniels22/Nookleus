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
} from "../__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function postReq() {
  return new Request("http://test", { method: "POST", body: "{}" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("POST /api/email/drafts — gated on send_email (#105)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await POST(postReq(), noParams);

    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds only view_email", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: ["view_email"],
      }),
    });

    const res = await POST(postReq(), noParams);

    expect(res.status).toBe(403);
  });

  it("passes the gate when the caller holds send_email — the handler runs", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: ["send_email"],
      }),
    });

    const res = await POST(postReq(), noParams);

    // Empty body — the handler rejects with 400 for the missing accountId,
    // proving the gate let the request through rather than rejecting it 403.
    expect(res.status).toBe(400);
  });

  it("admins pass the gate without holding the key", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await POST(postReq(), noParams);

    expect(res.status).not.toBe(403);
  });
});
