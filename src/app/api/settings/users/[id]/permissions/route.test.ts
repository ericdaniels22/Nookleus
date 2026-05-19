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

import { GET, PUT } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../__test-utils__/request-context-fakes";
import { fakeUsersServiceClient } from "../../__test-utils__/service-fake";

const params = { params: Promise.resolve({ id: "target-user" }) };

// The target member exists in the active org — so the PUT body's
// membership lookup succeeds and any failure is the wrapper's gate, not a
// missing-member 404.
const serviceWithTarget = () =>
  fakeUsersServiceClient({
    tables: {
      user_organizations: [
        { id: "m-target", user_id: "target-user", organization_id: "org-1" },
      ],
    },
  });

const putGrants = () =>
  new Request("http://test/api/settings/users/target-user/permissions", {
    method: "PUT",
    body: JSON.stringify({ access_settings: true }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createServiceClient).mockReturnValue(serviceWithTarget() as never);
});

// #100 — these two endpoints were ungated logged-in-only. The PUT is the
// self-privilege-escalation hole the PRD called out: a non-admin could
// grant themselves every permission. Both are now gated on
// `access_settings`.
describe("GET /api/settings/users/[id]/permissions — gated on access_settings (#100)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await GET(putGrants(), params);

    expect(res.status).toBe(401);
  });

  it("returns 403 for a member without access_settings", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
      }) as never,
    );

    const res = await GET(putGrants(), params);

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

    const res = await GET(putGrants(), params);

    expect(res.status).toBe(200);
  });
});

describe("PUT /api/settings/users/[id]/permissions — gated on access_settings (#100)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await PUT(putGrants(), params);

    expect(res.status).toBe(401);
  });

  // The privilege-escalation guard: a non-admin without `access_settings`
  // can no longer rewrite anyone's permission grants — including their own.
  it("returns 403 for a non-admin without access_settings (privilege escalation blocked)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
      }) as never,
    );

    const res = await PUT(putGrants(), params);

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

    const res = await PUT(putGrants(), params);

    expect(res.status).toBe(200);
  });

  it("allows an admin regardless of grants", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "admin", grants: [] }),
      }) as never,
    );

    const res = await PUT(putGrants(), params);

    expect(res.status).toBe(200);
  });
});
