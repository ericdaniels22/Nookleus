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
// `encrypt` reaches into ENCRYPTION_KEY at module load; the post-rewrite
// route only invokes it when a PATCH body sets `password`, but mocking
// keeps test setup hermetic.
vi.mock("@/lib/encryption", () => ({
  encrypt: vi.fn(() => "enc:test"),
}));

import { DELETE, PATCH } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeServiceClient,
  fakeUserClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

type Account = {
  id: string;
  organization_id: string;
  user_id: string | null;
};

function withAccounts(accounts: Account[]) {
  vi.mocked(createServiceClient).mockReturnValue(
    fakeServiceClient({ tables: { email_accounts: accounts } }) as never,
  );
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function deleteReq() {
  return new Request("http://test", { method: "DELETE" });
}

function patchReq(body: Record<string, unknown> = { label: "renamed" }) {
  return new Request("http://test", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const SHARED_IN_ORG = (id = "acc-shared"): Account => ({
  id,
  organization_id: "org-1",
  user_id: null,
});
const PERSONAL_OWNED_BY = (owner: string, id = "acc-personal"): Account => ({
  id,
  organization_id: "org-1",
  user_id: owner,
});
const CROSS_ORG = (id = "acc-other"): Account => ({
  id,
  organization_id: "org-2",
  user_id: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// Both DELETE and PATCH require canManage on the target account per ADR 0001:
//   Shared    — admin in same org only
//   Personal  — owner OR admin in same org
//   Cross-org — never
// 401/403 from the wrapper precede the access-module check; the access matrix
// itself decides 404 (canSee false) vs 403 (canSee true, canManage false).

describe("DELETE /api/email/accounts/[id] — requires canManage (#141, ADR 0001)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await DELETE(deleteReq(), paramsFor("acc-1"));

    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds no email permission", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: [],
      }),
    });

    const res = await DELETE(deleteReq(), paramsFor("acc-1"));

    expect(res.status).toBe(403);
  });

  it("returns 404 for an account in a different Organization", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([CROSS_ORG("acc-1")]);

    const res = await DELETE(deleteReq(), paramsFor("acc-1"));

    expect(res.status).toBe(404);
  });

  it("returns 404 for a Personal account in own org owned by someone else (non-admin caller)", async () => {
    // Content-private: a non-owner, non-admin caller cannot even tell the
    // account exists.
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email", "send_email"],
      }),
    });
    withAccounts([PERSONAL_OWNED_BY("user-2", "acc-1")]);

    const res = await DELETE(deleteReq(), paramsFor("acc-1"));

    expect(res.status).toBe(404);
  });

  it("returns 403 when a non-admin tries to disconnect a Shared account", async () => {
    // canSee true (view_email holder sees Shared) but canManage false (only
    // admins manage Shared).
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email", "send_email"],
      }),
    });
    withAccounts([SHARED_IN_ORG("acc-1")]);

    const res = await DELETE(deleteReq(), paramsFor("acc-1"));

    expect(res.status).toBe(403);
  });

  it("succeeds when an admin disconnects a Shared account in their org", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([SHARED_IN_ORG("acc-1")]);

    const res = await DELETE(deleteReq(), paramsFor("acc-1"));

    expect(res.status).toBe(200);
  });

  it("succeeds when the owner disconnects their own Personal account", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email"],
      }),
    });
    withAccounts([PERSONAL_OWNED_BY("user-1", "acc-1")]);

    const res = await DELETE(deleteReq(), paramsFor("acc-1"));

    expect(res.status).toBe(200);
  });

  it("succeeds when an admin disconnects a Personal account owned by another user in the same org (offboarding)", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([PERSONAL_OWNED_BY("user-2", "acc-1")]);

    const res = await DELETE(deleteReq(), paramsFor("acc-1"));

    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/email/accounts/[id] — requires canManage (#141, ADR 0001)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await PATCH(patchReq(), paramsFor("acc-1"));

    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds no email permission", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: [],
      }),
    });

    const res = await PATCH(patchReq(), paramsFor("acc-1"));

    expect(res.status).toBe(403);
  });

  it("returns 404 for an account in a different Organization", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([CROSS_ORG("acc-1")]);

    const res = await PATCH(patchReq(), paramsFor("acc-1"));

    expect(res.status).toBe(404);
  });

  it("returns 404 for a Personal account in own org owned by someone else (non-admin caller)", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email", "send_email"],
      }),
    });
    withAccounts([PERSONAL_OWNED_BY("user-2", "acc-1")]);

    const res = await PATCH(patchReq(), paramsFor("acc-1"));

    expect(res.status).toBe(404);
  });

  it("returns 403 when a non-admin tries to edit a Shared account", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email", "send_email"],
      }),
    });
    withAccounts([SHARED_IN_ORG("acc-1")]);

    const res = await PATCH(patchReq(), paramsFor("acc-1"));

    expect(res.status).toBe(403);
  });

  it("admin can edit a Shared account in their org (canManage path)", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([SHARED_IN_ORG("acc-1")]);

    const res = await PATCH(patchReq(), paramsFor("acc-1"));

    // The update reaches the DB; the fake's `.single()` returns no row so
    // the route exits 500 with "no rows" — `not.toBe(403)` proves the access
    // module let the caller through.
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  it("owner can edit their own Personal account", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email"],
      }),
    });
    withAccounts([PERSONAL_OWNED_BY("user-1", "acc-1")]);

    const res = await PATCH(patchReq(), paramsFor("acc-1"));

    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  it("admin can edit a Personal account owned by another user in the same org", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([PERSONAL_OWNED_BY("user-2", "acc-1")]);

    const res = await PATCH(patchReq(), paramsFor("acc-1"));

    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });
});
