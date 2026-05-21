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

function postReq(body: Record<string, unknown> = {}) {
  return new Request("http://test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const COMPLETE_BODY = {
  to: "customer@example.com",
  subject: "Hello",
  body: "Hi",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// PRD #134: "send treated the same as canRead for now" — until that splits,
// the access matrix uses canRead for /send. Owners of a Personal account
// can send from it; view_email holders can send from Shared; admins cannot
// send from a Personal account they do not own (canRead false).
describe("POST /api/email/send — gated on view_email + canRead per account (#141)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await POST(postReq(), noParams);

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

    const res = await POST(postReq(), noParams);

    expect(res.status).toBe(403);
  });

  it("returns 400 when the caller passes the gate but the body omits required fields", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email"],
      }),
    });

    const res = await POST(postReq(), noParams);

    expect(res.status).toBe(400);
  });

  it("returns 404 for an accountId in a different Organization", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([{ id: "acc-1", organization_id: "org-2", user_id: null }]);

    const res = await POST(
      postReq({ ...COMPLETE_BODY, accountId: "acc-1" }),
      noParams,
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 for a Personal accountId owned by someone else (non-admin caller)", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email"],
      }),
    });
    withAccounts([{ id: "acc-1", organization_id: "org-1", user_id: "user-2" }]);

    const res = await POST(
      postReq({ ...COMPLETE_BODY, accountId: "acc-1" }),
      noParams,
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 when an admin tries to send from a Personal account they don't own (canRead=false)", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([{ id: "acc-1", organization_id: "org-1", user_id: "user-2" }]);

    const res = await POST(
      postReq({ ...COMPLETE_BODY, accountId: "acc-1" }),
      noParams,
    );

    expect(res.status).toBe(403);
  });
});
