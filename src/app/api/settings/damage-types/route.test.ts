import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase-api", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/get-active-org", () => ({ getActiveOrganizationId: vi.fn() }));

import { GET, POST, PUT, DELETE } from "./route";
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

const bodyReq = (method: string) =>
  new Request("http://test", { method, body: "{}" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// All four methods of the damage-type catalog are gated on access_settings.
describe("GET /api/settings/damage-types — gated on access_settings (#107)", () => {
  it("401 unauthenticated", async () => {
    authed({ user: null });
    expect((await GET(new Request("http://test"), noParams)).status).toBe(401);
  });
  it("403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(403);
  });
  it("lists damage types when the caller holds access_settings", async () => {
    authed(holds());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(200);
  });
  it("admins retain access without the key", async () => {
    authed(admin());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(200);
  });
});

describe("POST /api/settings/damage-types — gated on access_settings (#107)", () => {
  it("401 unauthenticated", async () => {
    authed({ user: null });
    expect((await POST(bodyReq("POST"), noParams)).status).toBe(401);
  });
  it("403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await POST(bodyReq("POST"), noParams)).status).toBe(403);
  });
  it("passes the gate when the caller holds access_settings", async () => {
    authed(holds());
    expect((await POST(bodyReq("POST"), noParams)).status).not.toBe(403);
  });
  it("admins pass the gate without the key", async () => {
    authed(admin());
    expect((await POST(bodyReq("POST"), noParams)).status).not.toBe(403);
  });
});

describe("PUT /api/settings/damage-types — gated on access_settings (#107)", () => {
  it("401 unauthenticated", async () => {
    authed({ user: null });
    expect((await PUT(bodyReq("PUT"), noParams)).status).toBe(401);
  });
  it("403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await PUT(bodyReq("PUT"), noParams)).status).toBe(403);
  });
  it("passes the gate when the caller holds access_settings", async () => {
    authed(holds());
    expect((await PUT(bodyReq("PUT"), noParams)).status).not.toBe(403);
  });
  it("admins pass the gate without the key", async () => {
    authed(admin());
    expect((await PUT(bodyReq("PUT"), noParams)).status).not.toBe(403);
  });
});

describe("DELETE /api/settings/damage-types — gated on access_settings (#107)", () => {
  it("401 unauthenticated", async () => {
    authed({ user: null });
    expect((await DELETE(new Request("http://test"), noParams)).status).toBe(401);
  });
  it("403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await DELETE(new Request("http://test"), noParams)).status).toBe(403);
  });
  it("passes the gate when the caller holds access_settings", async () => {
    authed(holds());
    expect(
      (await DELETE(new Request("http://test"), noParams)).status,
    ).not.toBe(403);
  });
  it("admins pass the gate without the key", async () => {
    authed(admin());
    expect(
      (await DELETE(new Request("http://test"), noParams)).status,
    ).not.toBe(403);
  });
});
