import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase-api", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/get-active-org", () => ({ getActiveOrganizationId: vi.fn() }));

import { GET, PATCH } from "./route";
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

function patchReq() {
  return new Request("http://test", { method: "PATCH", body: "{}" });
}

// The contract_email_settings table is a seeded singleton; route bodies error
// if it is missing, so the holder/admin cases seed one row.
const settingsRow = { contract_email_settings: [{ id: "ce-1", provider: "resend" }] };

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
    extraTables: settingsRow,
  }),
});
const admin = () => ({
  user: { id: "a" },
  tables: memberTables({
    userId: "a",
    role: "admin",
    grants: [],
    extraTables: settingsRow,
  }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/settings/contract-email — gated on access_settings (#107)", () => {
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

describe("PATCH /api/settings/contract-email — gated on access_settings (#107)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    expect((await PATCH(patchReq(), noParams)).status).toBe(401);
  });

  it("returns 403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await PATCH(patchReq(), noParams)).status).toBe(403);
  });

  it("updates settings when the caller holds access_settings", async () => {
    authed(holds());
    expect((await PATCH(patchReq(), noParams)).status).toBe(200);
  });

  it("admins retain access without holding the key", async () => {
    authed(admin());
    expect((await PATCH(patchReq(), noParams)).status).toBe(200);
  });
});
