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

import { PATCH } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";
import { fakeUsersServiceClient } from "../__test-utils__/service-fake";

const params = { params: Promise.resolve({ id: "target-user" }) };

const patch = () =>
  new Request("http://test/api/settings/users/target-user", {
    method: "PATCH",
    body: JSON.stringify({ full_name: "Renamed Member" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createServiceClient).mockReturnValue(
    fakeUsersServiceClient() as never,
  );
});

// #100 — PATCH /api/settings/users/[id] was ungated logged-in-only; it is
// now gated on `access_settings`.
describe("PATCH /api/settings/users/[id] — gated on access_settings (#100)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await PATCH(patch(), params);

    expect(res.status).toBe(401);
  });

  it("returns 403 for a member without access_settings", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
      }) as never,
    );

    const res = await PATCH(patch(), params);

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

    const res = await PATCH(patch(), params);

    expect(res.status).toBe(200);
  });
});
