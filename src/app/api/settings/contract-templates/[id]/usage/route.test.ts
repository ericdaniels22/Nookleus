import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/permissions-api", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { makeSupabaseFake } from "@/lib/contracts/__test-utils__/supabase-fake";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function grantPermission() {
  vi.mocked(createServerSupabaseClient).mockResolvedValue({} as never);
  vi.mocked(requirePermission).mockResolvedValue({ ok: true, userId: "user-1" });
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
}

function denyPermission() {
  vi.mocked(createServerSupabaseClient).mockResolvedValue({} as never);
  vi.mocked(requirePermission).mockResolvedValue({
    ok: false,
    response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
  });
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
