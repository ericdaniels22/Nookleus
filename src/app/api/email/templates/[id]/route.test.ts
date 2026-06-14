import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase-api", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/get-active-org", () => ({ getActiveOrganizationId: vi.fn() }));

import { PUT, DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function putReq(body: unknown = { name: "Updated" }) {
  return new Request("http://test", { method: "PUT", body: JSON.stringify(body) });
}
const delReq = () => new Request("http://test", { method: "DELETE" });

// A caller's seeded tables: membership/grants plus one Organization-wide and
// one Personal template the caller owns.
function tablesFor(opts: { userId: string; role: string; grants?: string[] }) {
  return {
    ...memberTables(opts),
    email_templates: [
      { id: "t-org", owner_user_id: null, organization_id: "org-1", name: "Shared" },
      { id: "t-mine", owner_user_id: opts.userId, organization_id: "org-1", name: "Mine" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// PUT/DELETE derive the template's scope from the existing row, then apply the
// same scope-conditional gate as create: Organization-wide mutations require
// manage_email_templates (admins auto-pass); Personal ones are always the
// owner's. RLS guarantees a row that loads is one the caller may at least see.
describe("PUT /api/email/templates/[id] — scope-conditional permission", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    expect((await PUT(putReq(), params("t-org"))).status).toBe(401);
  });

  it("returns 404 when the template does not exist (or is invisible)", async () => {
    authed({
      user: { id: "u" },
      tables: tablesFor({ userId: "u", role: "admin", grants: ["access_settings"] }),
    });
    expect((await PUT(putReq(), params("missing"))).status).toBe(404);
  });

  it("denies editing an Organization-wide template without manage_email_templates", async () => {
    authed({
      user: { id: "u" },
      tables: tablesFor({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
    });
    expect((await PUT(putReq(), params("t-org"))).status).toBe(403);
  });

  it("allows editing an Organization-wide template with manage_email_templates", async () => {
    authed({
      user: { id: "u" },
      tables: tablesFor({
        userId: "u",
        role: "crew_lead",
        grants: ["access_settings", "manage_email_templates"],
      }),
    });
    expect((await PUT(putReq(), params("t-org"))).status).not.toBe(403);
  });

  it("allows editing the caller's own Personal template without the key", async () => {
    authed({
      user: { id: "u" },
      tables: tablesFor({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
    });
    expect((await PUT(putReq(), params("t-mine"))).status).not.toBe(403);
  });
});

describe("DELETE /api/email/templates/[id] — scope-conditional permission", () => {
  it("denies deleting an Organization-wide template without manage_email_templates", async () => {
    authed({
      user: { id: "u" },
      tables: tablesFor({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
    });
    expect((await DELETE(delReq(), params("t-org"))).status).toBe(403);
  });

  it("allows deleting an Organization-wide template with manage_email_templates", async () => {
    authed({
      user: { id: "u" },
      tables: tablesFor({
        userId: "u",
        role: "crew_lead",
        grants: ["access_settings", "manage_email_templates"],
      }),
    });
    expect((await DELETE(delReq(), params("t-org"))).status).not.toBe(403);
  });

  it("allows deleting the caller's own Personal template without the key", async () => {
    authed({
      user: { id: "u" },
      tables: tablesFor({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
    });
    expect((await DELETE(delReq(), params("t-mine"))).status).not.toBe(403);
  });
});
