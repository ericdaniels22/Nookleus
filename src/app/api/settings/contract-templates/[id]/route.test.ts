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

import { GET, DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../__test-utils__/request-context-fakes";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

// GET/DELETE are gated on `access_settings` (#107) and org-scoped (#98). The
// caller is a member of `org-1` holding `access_settings`; `contract_templates`
// is seeded onto the User client so the route's reads/writes see it.
function callerWithTemplates(rows: Array<Record<string, unknown>>) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: ["access_settings"],
        extraTables: { contract_templates: rows },
      }),
    }) as never,
  );
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
}

// A caller who is signed in and a member of org-1 but holds no permissions.
function callerWithoutAccess() {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: [],
      }),
    }) as never,
  );
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
}

function unauthenticated() {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({ user: null }) as never,
  );
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
}

describe("GET /api/settings/contract-templates/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    unauthenticated();

    const res = await GET(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks access_settings", async () => {
    callerWithoutAccess();

    const res = await GET(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(403);
  });

  it("returns the template when it belongs to the active organization", async () => {
    callerWithTemplates([
      { id: "tpl-1", organization_id: "org-1", name: "Mine" },
    ]);

    const res = await GET(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Mine");
  });

  it("returns 404 for a template in another organization", async () => {
    callerWithTemplates([
      { id: "tpl-1", organization_id: "other-org", name: "Theirs" },
    ]);

    const res = await GET(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a missing template", async () => {
    callerWithTemplates([]);

    const res = await GET(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/settings/contract-templates/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    unauthenticated();

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks access_settings", async () => {
    callerWithoutAccess();

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(403);
  });

  it("soft-archives a template in the active organization", async () => {
    callerWithTemplates([
      { id: "tpl-1", organization_id: "org-1", name: "Mine" },
    ]);

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("returns 404 for a template in another organization", async () => {
    callerWithTemplates([
      { id: "tpl-1", organization_id: "other-org", name: "Theirs" },
    ]);

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a missing template", async () => {
    callerWithTemplates([]);

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(404);
  });
});
