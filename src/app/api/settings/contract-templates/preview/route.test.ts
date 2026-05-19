import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase-api", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/get-active-org", () => ({ getActiveOrganizationId: vi.fn() }));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../__test-utils__/request-context-fakes";

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

describe("POST /api/settings/contract-templates/preview — gated on access_settings (#107)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    expect((await POST(postReq(), noParams)).status).toBe(401);
  });

  it("returns 403 when the caller lacks access_settings", async () => {
    authed({
      user: { id: "u" },
      tables: memberTables({ userId: "u", role: "crew_member", grants: [] }),
    });
    expect((await POST(postReq(), noParams)).status).toBe(403);
  });

  it("passes the gate when the caller holds access_settings — the handler runs", async () => {
    authed({
      user: { id: "u" },
      tables: memberTables({
        userId: "u",
        role: "crew_member",
        grants: ["access_settings"],
      }),
    });
    // Empty body — the handler rejects with 400 for the missing fields,
    // proving the gate let the request through rather than rejecting it 403.
    expect((await POST(postReq(), noParams)).status).toBe(400);
  });

  it("admins pass the gate without holding the key", async () => {
    authed({
      user: { id: "a" },
      tables: memberTables({ userId: "a", role: "admin", grants: [] }),
    });
    expect((await POST(postReq(), noParams)).status).not.toBe(403);
  });
});
