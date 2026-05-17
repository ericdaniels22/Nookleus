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
vi.mock("@/lib/pdf-presets", () => ({
  listPresets: vi.fn(),
  createPreset: vi.fn(),
}));

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { listPresets } from "@/lib/pdf-presets";
import {
  fakeUserClient,
  memberTables,
} from "../email/__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(listPresets).mockResolvedValue([]);
});

describe("GET /api/pdf-presets (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await GET(new Request("http://test/api/pdf-presets"), noParams);

    expect(res.status).toBe(401);
    expect(listPresets).not.toHaveBeenCalled();
  });

  it("returns 403 when a non-admin holds neither view_estimates nor view_invoices", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
      }) as never,
    );

    const res = await GET(new Request("http://test/api/pdf-presets"), noParams);

    expect(res.status).toBe(403);
    expect(listPresets).not.toHaveBeenCalled();
  });

  it("allows a non-admin holding either of the two view permissions", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "crew_member",
          grants: ["view_invoices"],
        }),
      }) as never,
    );

    const res = await GET(new Request("http://test/api/pdf-presets"), noParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ presets: [] });
  });

  it("allows an admin who holds no explicit grants", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "admin", grants: [] }),
      }) as never,
    );

    const res = await GET(new Request("http://test/api/pdf-presets"), noParams);

    expect(res.status).toBe(200);
  });
});
