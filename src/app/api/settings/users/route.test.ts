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

import { GET, POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../__test-utils__/request-context-fakes";
import { fakeUsersServiceClient } from "./__test-utils__/service-fake";

const noParams = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createServiceClient).mockReturnValue(
    fakeUsersServiceClient() as never,
  );
});

// #100 — these two endpoints were ungated logged-in-only; they are now
// gated on `access_settings`.
describe("GET /api/settings/users — gated on access_settings (#100)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await GET(new Request("http://test/api/settings/users"), noParams);

    expect(res.status).toBe(401);
  });

  it("returns 403 for a member without access_settings", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
      }) as never,
    );

    const res = await GET(new Request("http://test/api/settings/users"), noParams);

    expect(res.status).toBe(403);
  });

  it("allows a member holding access_settings", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "crew_member",
          grants: ["access_settings"],
        }),
      }) as never,
    );

    const res = await GET(new Request("http://test/api/settings/users"), noParams);

    expect(res.status).toBe(200);
  });
});

describe("POST /api/settings/users — gated on access_settings (#100)", () => {
  const invite = () =>
    new Request("http://test/api/settings/users", {
      method: "POST",
      body: JSON.stringify({ email: "new@test.com", full_name: "New Member" }),
    });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await POST(invite(), noParams);

    expect(res.status).toBe(401);
  });

  it("returns 403 for a member without access_settings", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "crew_lead", grants: [] }),
      }) as never,
    );

    const res = await POST(invite(), noParams);

    expect(res.status).toBe(403);
  });

  it("allows a member holding access_settings", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "crew_lead",
          grants: ["access_settings"],
        }),
      }) as never,
    );

    const res = await POST(invite(), noParams);

    expect(res.status).toBe(201);
  });

  it("allows an admin regardless of grants", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "admin", grants: [] }),
      }) as never,
    );

    const res = await POST(invite(), noParams);

    expect(res.status).toBe(201);
  });
});
