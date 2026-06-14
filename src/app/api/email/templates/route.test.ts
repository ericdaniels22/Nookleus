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
