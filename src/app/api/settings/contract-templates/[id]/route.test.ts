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

// These routes are logged-in only and query the User client directly. The
// caller is a plain member of `org-1`; `contract_templates` is seeded onto
// the User client so the route's reads/writes see it.
function callerWithTemplates(rows: Array<Record<string, unknown>>) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        extraTables: { contract_templates: rows },
      }),
    }) as never,
  );
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
}

describe("GET /api/settings/contract-templates/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
