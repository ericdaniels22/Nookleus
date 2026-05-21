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

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeServiceClient,
  fakeUserClient,
  memberTables,
} from "../../../__test-utils__/request-context-fakes";

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

function postReq() {
  return new Request("http://test", { method: "POST" });
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

// The connection-test endpoint reads the account's encrypted password to
// run the live IMAP/SMTP probes. Reading the credential is a manage-level
// action — the access matrix puts that in the same column as
// PATCH/DELETE (admin for Shared, owner-or-admin for Personal).

describe("POST /api/email/accounts/[id]/test — requires canManage (#141, ADR 0001)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await POST(postReq(), paramsFor("acc-1"));

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

    const res = await POST(postReq(), paramsFor("acc-1"));

    expect(res.status).toBe(403);
  });

  it("returns 404 for an account in a different Organization", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([CROSS_ORG("acc-1")]);

    const res = await POST(postReq(), paramsFor("acc-1"));

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

    const res = await POST(postReq(), paramsFor("acc-1"));

    expect(res.status).toBe(404);
  });

  it("returns 403 when a non-admin tries to test a Shared account", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email", "send_email"],
      }),
    });
    withAccounts([SHARED_IN_ORG("acc-1")]);

    const res = await POST(postReq(), paramsFor("acc-1"));

    expect(res.status).toBe(403);
  });

  it("admin testing a Shared account passes the access gate (reaches the IMAP probe)", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([SHARED_IN_ORG("acc-1")]);

    const res = await POST(postReq(), paramsFor("acc-1"));

    // The access module lets the caller through. The downstream IMAP probe
    // fails against a non-existent host, but the access decision is not 403/404.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  it("owner testing their own Personal account passes the access gate", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email"],
      }),
    });
    withAccounts([PERSONAL_OWNED_BY("user-1", "acc-1")]);

    const res = await POST(postReq(), paramsFor("acc-1"));

    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });
});
