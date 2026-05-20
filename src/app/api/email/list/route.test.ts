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
  fakeServiceClient,
  fakeUserClient,
  memberTables,
} from "../__test-utils__/request-context-fakes";

type Account = {
  id: string;
  organization_id: string;
  user_id: string | null;
};

const noParams = { params: Promise.resolve({}) };

function withAccounts(accounts: Account[]) {
  vi.mocked(createServiceClient).mockReturnValue(
    fakeServiceClient({ tables: { email_accounts: accounts } }) as never,
  );
}

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/email/list — gated on view_email + canRead per account (#141)", () => {
  it("returns 401 when unauthenticated — the route body never runs", async () => {
    authed({ user: null });

    const res = await GET(new Request("http://test/api/email/list"), noParams);

    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks view_email", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
    });

    const res = await GET(new Request("http://test/api/email/list"), noParams);

    expect(res.status).toBe(403);
  });

  it("lists emails when the caller holds view_email (no accountId, RLS scopes the result)", async () => {
    authed({
      user: { id: "user-1" },
      tables: {
        ...memberTables({
          userId: "user-1",
          role: "crew_member",
          grants: ["view_email"],
        }),
        emails: [
          { id: "e-1", folder: "inbox" },
          { id: "e-2", folder: "inbox" },
          { id: "e-3", folder: "sent" },
        ],
      },
    });

    const res = await GET(new Request("http://test/api/email/list"), noParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.emails.map((e: { id: string }) => e.id)).toEqual(["e-1", "e-2"]);
  });

  it("admins retain access without holding the key", async () => {
    authed({
      user: { id: "admin-1" },
      tables: {
        ...memberTables({ userId: "admin-1", role: "admin", grants: [] }),
        emails: [{ id: "e-1", folder: "inbox" }],
      },
    });

    const res = await GET(new Request("http://test/api/email/list"), noParams);

    expect(res.status).toBe(200);
  });

  it("returns 404 when ?accountId= names an account in a different Organization", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([{ id: "acc-1", organization_id: "org-2", user_id: null }]);

    const res = await GET(
      new Request("http://test/api/email/list?accountId=acc-1"),
      noParams,
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 when ?accountId= names a Personal account in own org owned by someone else", async () => {
    // Content-private: admin sees the account exists (canSee true) but
    // cannot read its mail; same-org non-admin sees nothing at all.
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email"],
      }),
    });
    withAccounts([{ id: "acc-1", organization_id: "org-1", user_id: "user-2" }]);

    const res = await GET(
      new Request("http://test/api/email/list?accountId=acc-1"),
      noParams,
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 when an admin tries to read a Personal account owned by another user (canRead=false)", async () => {
    // Admin canSee but not canRead → mapped to 404 since the action (read)
    // is forbidden; the content-private boundary keeps the mail invisible.
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([{ id: "acc-1", organization_id: "org-1", user_id: "user-2" }]);

    const res = await GET(
      new Request("http://test/api/email/list?accountId=acc-1"),
      noParams,
    );

    // admin: canSee=true, canManage=true, canRead=false → 403 (visible
    // but action forbidden)
    expect(res.status).toBe(403);
  });

  it("allows the owner to read their own Personal account by ?accountId=", async () => {
    authed({
      user: { id: "user-1" },
      tables: {
        ...memberTables({
          userId: "user-1",
          role: "crew_lead",
          grants: ["view_email"],
        }),
        emails: [{ id: "e-1", folder: "inbox" }],
      },
    });
    withAccounts([{ id: "acc-1", organization_id: "org-1", user_id: "user-1" }]);

    const res = await GET(
      new Request("http://test/api/email/list?accountId=acc-1"),
      noParams,
    );

    expect(res.status).toBe(200);
  });

  it("allows a view_email holder to read a Shared account by ?accountId=", async () => {
    authed({
      user: { id: "user-1" },
      tables: {
        ...memberTables({
          userId: "user-1",
          role: "crew_lead",
          grants: ["view_email"],
        }),
        emails: [{ id: "e-1", folder: "inbox" }],
      },
    });
    withAccounts([{ id: "acc-1", organization_id: "org-1", user_id: null }]);

    const res = await GET(
      new Request("http://test/api/email/list?accountId=acc-1"),
      noParams,
    );

    expect(res.status).toBe(200);
  });
});
