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

describe("GET /api/settings/company — gated on access_settings (#107)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    expect((await GET(new Request("http://test"), noParams)).status).toBe(401);
  });

  it("returns 403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(403);
  });

  it("returns settings when the caller holds access_settings", async () => {
    authed(holds());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(200);
  });

  it("admins retain access without holding the key", async () => {
    authed(admin());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(200);
  });
});

describe("PUT /api/settings/company — gated on access_settings (#107)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    expect((await PUT(putReq(), noParams)).status).toBe(401);
  });

  it("returns 403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await PUT(putReq(), noParams)).status).toBe(403);
  });

  it("saves settings when the caller holds access_settings", async () => {
    authed(holds());
    expect((await PUT(putReq(), noParams)).status).toBe(200);
  });

  it("admins retain access without holding the key", async () => {
    authed(admin());
    expect((await PUT(putReq(), noParams)).status).toBe(200);
  });
});
