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
import { MAX_TEMPLATE_BODY_HTML_LENGTH } from "@/lib/email/template-body-limit";

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

// Issue #660: PUT must validate the patch it builds. A request that carries no
// recognized editable field would otherwise issue an empty UPDATE — a no-op the
// real database rejects with a 500. And an explicit empty `name` would blank a
// field create refuses to leave empty. Both should be 400s, decided before the
// write, never reaching the database.
describe("PUT /api/email/templates/[id] — rejects an invalid patch", () => {
  it("returns 400 when no recognized editable field is supplied", async () => {
    authed({
      user: { id: "u" },
      tables: tablesFor({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
    });
    expect((await PUT(putReq({ scope: "organization" }), params("t-mine"))).status).toBe(400);
  });

  it("returns 400 when the patch would blank the name", async () => {
    authed({
      user: { id: "u" },
      tables: tablesFor({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
    });
    expect((await PUT(putReq({ name: "   " }), params("t-mine"))).status).toBe(400);
  });

  it("returns 413 when body_html exceeds the cap", async () => {
    authed({
      user: { id: "u" },
      tables: tablesFor({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
    });
    const huge = "a".repeat(MAX_TEMPLATE_BODY_HTML_LENGTH + 1);
    expect((await PUT(putReq({ body_html: huge }), params("t-mine"))).status).toBe(413);
  });
});

// Issue #658 M3: editing a template body must apply the same allowlist
// sanitization as create before storage.
describe("PUT /api/email/templates/[id] — sanitizes body_html before storage", () => {
  it("neutralizes a <script> payload in the persisted body_html", async () => {
    const writes: Array<{ table: string; payload: Record<string, unknown> }> = [];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u" },
        tables: tablesFor({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
        onWrite: (table, _op, payload) =>
          writes.push({ table, payload: payload as Record<string, unknown> }),
      }) as never,
    );

    await PUT(
      putReq({ body_html: '<p>Body</p><script>steal()</script>' }),
      params("t-mine"),
    );

    const write = writes.find((w) => w.table === "email_templates");
    expect(write).toBeTruthy();
    const html = write!.payload.body_html as string;
    expect(html).not.toContain("<script");
    expect(html).not.toContain("steal");
    expect(html).toContain("<p>Body</p>");
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
