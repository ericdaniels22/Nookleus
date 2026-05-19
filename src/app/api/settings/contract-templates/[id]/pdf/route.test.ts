import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase-api", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/get-active-org", () => ({ getActiveOrganizationId: vi.fn() }));

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  fakeServiceClient,
  memberTables,
} from "../../../../__test-utils__/request-context-fakes";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
  vi.mocked(createServiceClient).mockReturnValue(fakeServiceClient() as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// The POST on this route keeps its stricter `manage_contract_templates` rule;
// only the signed-URL GET is tightened to `access_settings` by #107.
describe("GET /api/settings/contract-templates/[id]/pdf — gated on access_settings (#107)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    expect((await GET(new Request("http://test"), paramsFor("tpl-1"))).status).toBe(
      401,
    );
  });

  it("returns 403 when the caller lacks access_settings", async () => {
    authed({
      user: { id: "u" },
      tables: memberTables({ userId: "u", role: "crew_member", grants: [] }),
    });
    expect((await GET(new Request("http://test"), paramsFor("tpl-1"))).status).toBe(
      403,
    );
  });

  it("passes the gate when the caller holds access_settings — the handler runs", async () => {
    authed({
      user: { id: "u" },
      tables: memberTables({
        userId: "u",
        role: "crew_member",
        grants: ["access_settings"],
      }),
    });
    // No template seeded — the handler returns 404, proving the gate let the
    // request through rather than rejecting it with 403.
    expect((await GET(new Request("http://test"), paramsFor("tpl-1"))).status).toBe(
      404,
    );
  });

  it("admins pass the gate without holding the key", async () => {
    authed({
      user: { id: "a" },
      tables: memberTables({ userId: "a", role: "admin", grants: [] }),
    });
    expect(
      (await GET(new Request("http://test"), paramsFor("tpl-1"))).status,
    ).not.toBe(403);
  });
});
