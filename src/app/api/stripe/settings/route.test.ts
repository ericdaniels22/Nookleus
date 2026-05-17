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
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  fakeServiceClient,
  memberTables,
} from "../../email/__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createServiceClient).mockReturnValue(
    fakeServiceClient({
      tables: { stripe_connection: [{ id: "conn-1", mode: "test" }] },
    }) as never,
  );
});

describe("GET /api/stripe/settings (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await GET(new Request("http://test/api/stripe/settings"), noParams);

    expect(res.status).toBe(401);
  });

  it("returns 403 when a non-admin lacks the access_settings permission", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
      }) as never,
    );

    const res = await GET(new Request("http://test/api/stripe/settings"), noParams);

    expect(res.status).toBe(403);
  });

  it("returns the connection for a caller holding access_settings", async () => {
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

    const res = await GET(new Request("http://test/api/stripe/settings"), noParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connection: { id: "conn-1", mode: "test" } });
  });
});
