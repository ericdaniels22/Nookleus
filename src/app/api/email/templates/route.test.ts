import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase-api", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/get-active-org", () => ({ getActiveOrganizationId: vi.fn() }));

import { GET, POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../__test-utils__/request-context-fakes";
import { MAX_TEMPLATE_BODY_HTML_LENGTH } from "@/lib/email/template-body-limit";

const noParams = { params: Promise.resolve({}) };

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function postReq(body: unknown) {
  return new Request("http://test", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// GET lists Organization-wide + own Personal templates; RLS enforces the
// visibility rule, so the route only needs the Settings-reach gate.
describe("GET /api/email/templates — gated on access_settings", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    expect((await GET(new Request("http://test"), noParams)).status).toBe(401);
  });

  it("returns 403 when the caller lacks access_settings", async () => {
    authed({
      user: { id: "u" },
      tables: memberTables({ userId: "u", role: "crew_member", grants: [] }),
    });
    expect((await GET(new Request("http://test"), noParams)).status).toBe(403);
  });

  it("lists when the caller holds access_settings", async () => {
    authed({
      user: { id: "u" },
      tables: memberTables({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
    });
    expect((await GET(new Request("http://test"), noParams)).status).toBe(200);
  });

  // The route's own job is org-scoping: it returns the Active Organization's
  // templates and nothing from another org. (RLS layers the org-wide-vs-own
  // Personal split on top; that rule can't be exercised against these fakes,
  // which don't model row-level security — so this pins what the route itself
  // enforces, the `.eq(organization_id, ...)` filter, via the response body
  // rather than only the status.)
  it("returns only the Active Organization's templates", async () => {
    authed({
      user: { id: "u" },
      tables: {
        ...memberTables({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
        email_templates: [
          { id: "t-org", owner_user_id: null, organization_id: "org-1", name: "Shared" },
          { id: "t-mine", owner_user_id: "u", organization_id: "org-1", name: "Mine" },
          { id: "t-foreign", owner_user_id: null, organization_id: "org-2", name: "Other org" },
        ],
      },
    });
    const res = await GET(new Request("http://test"), noParams);
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["t-org", "t-mine"]));
    expect(ids).not.toContain("t-foreign");
  });
});

// POST is where the scope-conditional gate lives: an Organization-wide
// template requires `manage_email_templates` (admins auto-pass), while a
// Personal template is always the caller's to create. The route gate is the
// looser `access_settings` (you must be able to reach Settings); the
// per-scope permission is enforced inside via authorizeTemplateMutation.
describe("POST /api/email/templates — scope-conditional permission", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    expect((await POST(postReq({ scope: "personal", name: "T" }), noParams)).status).toBe(401);
  });

  it("denies an Organization-wide create when the caller lacks manage_email_templates", async () => {
    authed({
      user: { id: "u" },
      // Has Settings access but NOT the templates-management permission.
      tables: memberTables({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
    });
    expect(
      (await POST(postReq({ scope: "organization", name: "Shared" }), noParams)).status,
    ).toBe(403);
  });

  it("allows an Organization-wide create when the caller holds manage_email_templates", async () => {
    authed({
      user: { id: "u" },
      tables: memberTables({
        userId: "u",
        role: "crew_lead",
        grants: ["access_settings", "manage_email_templates"],
      }),
    });
    // The fake User client cannot return an inserted row, so the insert
    // surfaces a db error rather than a 201 — but never a 403, proving the
    // scope gate let the Organization-wide write through.
    expect(
      (await POST(postReq({ scope: "organization", name: "Shared" }), noParams)).status,
    ).not.toBe(403);
  });

  it("admins may create Organization-wide without holding the key", async () => {
    authed({
      user: { id: "a" },
      tables: memberTables({ userId: "a", role: "admin", grants: ["access_settings"] }),
    });
    expect(
      (await POST(postReq({ scope: "organization", name: "Shared" }), noParams)).status,
    ).not.toBe(403);
  });

  it("allows a Personal create even without manage_email_templates", async () => {
    authed({
      user: { id: "u" },
      tables: memberTables({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
    });
    expect(
      (await POST(postReq({ scope: "personal", name: "Mine" }), noParams)).status,
    ).not.toBe(403);
  });
});

// Issue #660: scope decides the permission gate AND the owner, so an
// unrecognized value must not be silently coerced to Personal — it could mask a
// client bug that meant Organization-wide. An explicitly-supplied bad scope is a
// 400; omitting scope still defaults to Personal for backward compatibility.
describe("POST /api/email/templates — rejects an unrecognized scope", () => {
  it("returns 400 when scope is neither organization nor personal", async () => {
    authed({
      user: { id: "u" },
      tables: memberTables({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
    });
    expect(
      (await POST(postReq({ scope: "global", name: "T" }), noParams)).status,
    ).toBe(400);
  });
});

// Issue #660: a template body is otherwise an unbounded write — inline base64
// images can bloat it without limit, and it flows into other members' outgoing
// mail. Reject an over-cap body before storage with 413 Payload Too Large.
describe("POST /api/email/templates — caps the body length", () => {
  it("returns 413 when body_html exceeds the cap", async () => {
    authed({
      user: { id: "u" },
      tables: memberTables({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
    });
    const huge = "a".repeat(MAX_TEMPLATE_BODY_HTML_LENGTH + 1);
    expect(
      (await POST(postReq({ scope: "personal", name: "T", body_html: huge }), noParams)).status,
    ).toBe(413);
  });
});

// Issue #658 M3: an org-shared template body flows into OTHER members' outgoing
// email, so the create path must allowlist-sanitize body_html before storage —
// making the migration-572 "stored as sanitized HTML" comment true.
describe("POST /api/email/templates — sanitizes body_html before storage", () => {
  it("neutralizes a <script> payload in the persisted body_html", async () => {
    const writes: Array<{ table: string; payload: Record<string, unknown> }> = [];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u" },
        tables: memberTables({ userId: "u", role: "crew_member", grants: ["access_settings"] }),
        onWrite: (table, _op, payload) =>
          writes.push({ table, payload: payload as Record<string, unknown> }),
      }) as never,
    );

    await POST(
      postReq({
        scope: "personal",
        name: "T",
        body_html: '<p>Body</p><script>steal()</script>',
      }),
      noParams,
    );

    const write = writes.find((w) => w.table === "email_templates");
    expect(write).toBeTruthy();
    const html = write!.payload.body_html as string;
    expect(html).not.toContain("<script");
    expect(html).not.toContain("steal");
    expect(html).toContain("<p>Body</p>");
  });
});
