import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { requirePagePermission } from "./require-page-permission";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// A fake User client covering exactly the surface `resolveCaller` touches:
// auth.getUser, the `user_organizations` membership lookup (maybeSingle),
// and the `user_organization_permissions` grants lookup (awaited list).
// Mirrors the fake in with-request-context.test.ts — pages pass their own
// already-created client, so the helper never calls createServerSupabaseClient.
function fakeUserClient(opts: {
  user: { id: string } | null;
  membership?: { id: string; role: string } | null;
  grants?: string[];
}) {
  const membership = opts.membership ?? null;
  const grants = opts.grants ?? [];
  return {
    auth: {
      async getUser() {
        return { data: { user: opts.user }, error: null };
      },
    },
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        async maybeSingle() {
          return { data: membership, error: null };
        },
        then(
          resolve: (v: {
            data: { permission_key: string }[];
            error: null;
          }) => unknown,
        ) {
          return resolve({
            data: grants.map((permission_key) => ({ permission_key })),
            error: null,
          });
        },
      };
      return builder;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("requirePagePermission", () => {
  it("denies an unauthenticated caller", async () => {
    const result = await requirePagePermission(
      fakeUserClient({ user: null }) as never,
      { permission: "view_estimates" },
    );

    expect(result.ok).toBe(false);
  });

  it("denies a member who lacks the required permission", async () => {
    const result = await requirePagePermission(
      fakeUserClient({
        user: { id: "user-1" },
        membership: { id: "m-1", role: "member" },
        grants: ["view_invoices"],
      }) as never,
      { permission: "view_estimates" },
    );

    expect(result.ok).toBe(false);
  });

  it("admits a member who holds the required permission, carrying the resolved caller", async () => {
    const result = await requirePagePermission(
      fakeUserClient({
        user: { id: "user-1" },
        membership: { id: "m-1", role: "member" },
        grants: ["view_estimates"],
      }) as never,
      { permission: "view_estimates" },
    );

    expect(result).toEqual({
      ok: true,
      userId: "user-1",
      orgId: "org-1",
      role: "member",
    });
  });

  it("admits an admin against a permission rule they hold no grant for", async () => {
    const result = await requirePagePermission(
      fakeUserClient({
        user: { id: "admin-1" },
        membership: { id: "m-1", role: "admin" },
        grants: [],
      }) as never,
      { permission: "create_estimates" },
    );

    expect(result.ok).toBe(true);
  });

  it("denies a non-admin against an adminOnly rule", async () => {
    const result = await requirePagePermission(
      fakeUserClient({
        user: { id: "user-1" },
        membership: { id: "m-1", role: "member" },
      }) as never,
      { adminOnly: true },
    );

    expect(result.ok).toBe(false);
  });

  it("admits any authenticated caller against an empty (logged-in-only) rule", async () => {
    const result = await requirePagePermission(
      fakeUserClient({ user: { id: "user-1" }, membership: null }) as never,
      {},
    );

    expect(result).toEqual({
      ok: true,
      userId: "user-1",
      orgId: "org-1",
      role: null,
    });
  });
});
