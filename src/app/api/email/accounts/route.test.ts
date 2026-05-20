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
// `encrypt` needs ENCRYPTION_KEY in env; the user_id-rule tests reach past
// the ownership check into the handler body and would otherwise crash on
// `getKey`. Mock returns a stable bytestring so the route can proceed to
// the DB insert step the queryBuilder fakes already handle.
vi.mock("@/lib/encryption", () => ({
  encrypt: vi.fn(() => "enc:test"),
}));

import { GET, POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeServiceClient,
  fakeUserClient,
  memberTables,
} from "../__test-utils__/request-context-fakes";

function withServiceAccounts(accounts: Record<string, unknown>[]) {
  vi.mocked(createServiceClient).mockReturnValue(
    fakeServiceClient({ tables: { email_accounts: accounts } }) as never,
  );
}

const noParams = { params: Promise.resolve({}) };

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function postReq(body: Record<string, unknown> = {}) {
  return new Request("http://test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// A minimal valid body — all three required fields. Tests of the new
// user_id rule layer extra fields on top of this so they exercise the
// validation, not the 400-missing-fields path.
const VALID_FIELDS = {
  email_address: "team@example.com",
  username: "team@example.com",
  password: "secret",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/email/accounts — gated on view_email (#105)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await GET(new Request("http://test/api/email/accounts"), noParams);

    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks view_email", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
    });

    const res = await GET(new Request("http://test/api/email/accounts"), noParams);

    expect(res.status).toBe(403);
  });

  it("lists accounts when the caller holds view_email", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: ["view_email"],
      }),
    });

    const res = await GET(new Request("http://test/api/email/accounts"), noParams);

    expect(res.status).toBe(200);
  });

  it("admins retain access without holding the key", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await GET(new Request("http://test/api/email/accounts"), noParams);

    expect(res.status).toBe(200);
  });

  // PRD #134: admins get a management view of every account in their org
  // (including others' Personal accounts they cannot read) through
  // ?asAdmin=true. RLS hides those rows from the User client; the route
  // reads through the Service client for this view only.
  it("?asAdmin=true on an admin returns the Service-client view (sees others' Personal accounts)", async () => {
    const adminViewable = {
      id: "acc-personal-of-other",
      user_id: "user-other",
      organization_id: "org-1",
      label: "user-other's inbox",
    };
    authed({
      user: { id: "admin-1" },
      // Empty `email_accounts` on the User client — RLS would hide Personal
      // accounts owned by others from the admin.
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withServiceAccounts([adminViewable]);

    const res = await GET(
      new Request("http://test/api/email/accounts?asAdmin=true"),
      noParams,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((a: { id: string }) => a.id)).toEqual([
      "acc-personal-of-other",
    ]);
  });

  it("?asAdmin=true on a non-admin is ignored — still uses the User client (own canRead-set only)", async () => {
    const shouldNotLeak = {
      id: "acc-personal-of-other",
      user_id: "user-other",
      organization_id: "org-1",
    };
    authed({
      user: { id: "user-1" },
      tables: {
        ...memberTables({
          userId: "user-1",
          role: "crew_lead",
          grants: ["view_email"],
        }),
        // The User client sees an empty `email_accounts` table — that
        // mirrors what RLS does for a non-admin who has no own Personal
        // and no Shared accounts.
        email_accounts: [],
      },
    });
    withServiceAccounts([shouldNotLeak]);

    const res = await GET(
      new Request("http://test/api/email/accounts?asAdmin=true"),
      noParams,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});

describe("POST /api/email/accounts — gated on send_email (#105)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await POST(postReq(), noParams);

    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds only view_email", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: ["view_email"],
      }),
    });

    const res = await POST(postReq(), noParams);

    expect(res.status).toBe(403);
  });

  it("passes the gate when the caller holds send_email — the handler runs", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: ["send_email"],
      }),
    });

    const res = await POST(postReq(), noParams);

    // Empty body — the handler rejects with 400 for missing fields, proving
    // the gate let the request through rather than rejecting it with 403.
    expect(res.status).toBe(400);
  });

  it("admins pass the gate without holding the key", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await POST(postReq(), noParams);

    expect(res.status).not.toBe(403);
  });
});

// PRD #134 / ADR 0001: who may own a new Email account.
//
//   Admin     — may create Shared (`user_id: null`) or Personal owned by
//               any member of their Organization.
//   Non-admin — may only create a Personal account owned by themselves;
//               any other value (null, or another user's id) returns 403.
describe("POST /api/email/accounts — user_id ownership rule (#141, PRD #134)", () => {
  it("rejects a non-admin who tries to create an account owned by someone else", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["send_email"],
      }),
    });

    const res = await POST(
      postReq({ ...VALID_FIELDS, user_id: "user-2" }),
      noParams,
    );

    expect(res.status).toBe(403);
  });

  it("rejects a non-admin who tries to create a Shared account (user_id omitted)", async () => {
    // PRD #134: only admin may create a Shared (`user_id: null`) account.
    // For a non-admin, omitting `user_id` is also "any other value" → 403.
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["send_email"],
      }),
    });

    const res = await POST(postReq(VALID_FIELDS), noParams);

    expect(res.status).toBe(403);
  });

  it("allows a non-admin to create a Personal account owned by themselves", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["send_email"],
      }),
    });

    const res = await POST(
      postReq({ ...VALID_FIELDS, user_id: "user-1" }),
      noParams,
    );

    expect(res.status).not.toBe(403);
  });

  it("allows an admin to create a Shared account (user_id omitted)", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await POST(postReq(VALID_FIELDS), noParams);

    expect(res.status).not.toBe(403);
  });

  it("allows an admin to create a Personal account on behalf of another user", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await POST(
      postReq({ ...VALID_FIELDS, user_id: "user-2" }),
      noParams,
    );

    expect(res.status).not.toBe(403);
  });
});
