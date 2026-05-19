import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase-api", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/get-active-org", () => ({ getActiveOrganizationId: vi.fn() }));

import { GET, PUT } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function putReq() {
  return new Request("http://test", { method: "PUT", body: "{}" });
}

const lacks = () => ({
  user: { id: "u" },
  tables: memberTables({ userId: "u", role: "crew_member", grants: [] }),
});
const holds = () => ({
  user: { id: "u" },
  tables: memberTables({
    userId: "u",
    role: "crew_member",
    grants: ["access_settings"],
  }),
});
const admin = () => ({
  user: { id: "a" },
  tables: memberTables({ userId: "a", role: "admin", grants: [] }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/settings/signatures — gated on access_settings (#107)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    expect((await GET(new Request("http://test"), noParams)).status).toBe(401);
  });

  it("returns 403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(403);
  });

  it("returns signatures when the caller holds access_settings", async () => {
    authed(holds());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(200);
  });

  it("admins retain access without holding the key", async () => {
    authed(admin());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(200);
  });
});

describe("PUT /api/settings/signatures — gated on access_settings (#107)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    expect((await PUT(putReq(), noParams)).status).toBe(401);
  });

  it("returns 403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await PUT(putReq(), noParams)).status).toBe(403);
  });

  it("passes the gate when the caller holds access_settings — the handler runs", async () => {
    authed(holds());
    // Empty body — the handler rejects with 400 for the missing account_id,
    // proving the gate let the request through rather than rejecting it 403.
    expect((await PUT(putReq(), noParams)).status).toBe(400);
  });

  it("admins pass the gate without holding the key", async () => {
    authed(admin());
    expect((await PUT(putReq(), noParams)).status).not.toBe(403);
  });
});
