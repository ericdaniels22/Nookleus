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
import { makeSupabaseFake } from "@/lib/contracts/__test-utils__/supabase-fake";
import {
  fakeUserClient,
  memberTables,
} from "../../../__test-utils__/request-context-fakes";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

// The route now runs through `withRequestContext`: the wrapper authenticates
// against the User client and the route body reads with the Service client.
function grantPermission() {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["manage_contract_templates"],
      }),
    }) as never,
  );
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
}

function denyPermission() {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
    }) as never,
  );
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
}

describe("GET /api/settings/contract-templates/[id]/usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when the caller lacks manage_contract_templates", async () => {
    denyPermission();
    const service = makeSupabaseFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await GET(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when the template is not in the active organization", async () => {
    grantPermission();
    const service = makeSupabaseFake();
    service.seed("contract_templates", [
      { id: "tpl-1", organization_id: "other-org" },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await GET(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(404);
  });

  it("returns empty blockers and zero draftCount for an unreferenced template", async () => {
    grantPermission();
    const service = makeSupabaseFake();
    service.seed("contract_templates", [
      { id: "tpl-1", organization_id: "org-1" },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await GET(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ blockers: [], draftCount: 0 });
  });

  it("returns the blocker list and draft count for a mixed set of referencing contracts", async () => {
    grantPermission();
    const service = makeSupabaseFake();
    service.seed("contract_templates", [
      { id: "tpl-1", organization_id: "org-1" },
    ]);
    service.seed("contracts", [
      { id: "c-sent", template_id: "tpl-1", status: "sent" },
      { id: "c-viewed", template_id: "tpl-1", status: "viewed" },
      { id: "c-draft-1", template_id: "tpl-1", status: "draft" },
      { id: "c-draft-2", template_id: "tpl-1", status: "draft" },
      { id: "c-signed", template_id: "tpl-1", status: "signed" },
      { id: "c-other", template_id: "tpl-2", status: "sent" },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await GET(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      blockers: [
        { contractId: "c-sent", status: "sent" },
        { contractId: "c-viewed", status: "viewed" },
      ],
      draftCount: 2,
    });
  });
});
