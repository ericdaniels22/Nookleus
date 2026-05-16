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

import { DELETE } from "./route";
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

describe("DELETE /api/settings/contract-templates/[id]/permanent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when the caller lacks manage_contract_templates", async () => {
    denyPermission();
    const service = makeSupabaseFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(403);
    expect(service.state.rpcCalls).toHaveLength(0);
  });

  it("returns 404 when the template is not in the active organization", async () => {
    grantPermission();
    const service = makeSupabaseFake();
    service.seed("contract_templates", [
      { id: "tpl-1", organization_id: "other-org", pdf_storage_path: null },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(404);
    expect(service.state.rpcCalls).toHaveLength(0);
  });

  it("returns 409 with the blocker list when a `sent` contract references the template", async () => {
    grantPermission();
    const service = makeSupabaseFake();
    service.seed("contract_templates", [
      { id: "tpl-1", organization_id: "org-1", pdf_storage_path: "org-1/templates/tpl-1.pdf" },
    ]);
    service.seed("contracts", [
      { id: "c-sent", template_id: "tpl-1", status: "sent" },
      { id: "c-draft", template_id: "tpl-1", status: "draft" },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("blocked");
    expect(body.blockers).toEqual([{ contractId: "c-sent", status: "sent" }]);
    // The advisory check short-circuits before the RPC.
    expect(service.state.rpcCalls).toHaveLength(0);
  });

  it("returns 409 when a `viewed` contract references the template", async () => {
    grantPermission();
    const service = makeSupabaseFake();
    service.seed("contract_templates", [
      { id: "tpl-1", organization_id: "org-1", pdf_storage_path: null },
    ]);
    service.seed("contracts", [
      { id: "c-viewed", template_id: "tpl-1", status: "viewed" },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(409);
    expect(service.state.rpcCalls).toHaveLength(0);
  });

  it("deletes a template with only draft + terminal references: calls the RPC and removes the PDF", async () => {
    grantPermission();
    const service = makeSupabaseFake();
    service.seed("contract_templates", [
      { id: "tpl-1", organization_id: "org-1", pdf_storage_path: "org-1/templates/tpl-1.pdf" },
    ]);
    service.seed("contracts", [
      { id: "c-draft", template_id: "tpl-1", status: "draft" },
      { id: "c-signed", template_id: "tpl-1", status: "signed" },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    expect(service.state.rpcCalls).toEqual([
      {
        name: "hard_delete_contract_template",
        args: { p_template_id: "tpl-1", p_org_id: "org-1" },
      },
    ]);
    expect(service.state.storageRemovals).toEqual([
      { bucket: "contract-pdfs", paths: ["org-1/templates/tpl-1.pdf"] },
    ]);
  });

  it("deletes a template with no contracts referencing it", async () => {
    grantPermission();
    const service = makeSupabaseFake();
    service.seed("contract_templates", [
      { id: "tpl-1", organization_id: "org-1", pdf_storage_path: null },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(200);
    expect(service.state.rpcCalls).toHaveLength(1);
    // No pdf_storage_path → no storage removal attempted.
    expect(service.state.storageRemovals).toHaveLength(0);
  });

  it("still returns 200 when the best-effort storage cleanup fails", async () => {
    grantPermission();
    const service = makeSupabaseFake();
    service.seed("contract_templates", [
      { id: "tpl-1", organization_id: "org-1", pdf_storage_path: "org-1/templates/tpl-1.pdf" },
    ]);
    service.setError("storage.contract-pdfs.remove", { message: "object not found" });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(200);
    expect(service.state.rpcCalls).toHaveLength(1);
  });

  it("returns 409 when the RPC's authoritative re-check loses a race (template_delete_blocked)", async () => {
    grantPermission();
    const service = makeSupabaseFake();
    service.seed("contract_templates", [
      { id: "tpl-1", organization_id: "org-1", pdf_storage_path: null },
    ]);
    service.setError("rpc.hard_delete_contract_template", {
      message: "template_delete_blocked: 1 contract(s) referencing template tpl-1 are still awaiting signature",
    });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("blocked");
  });

  it("returns 500 when the RPC fails for an unrecognized reason", async () => {
    grantPermission();
    const service = makeSupabaseFake();
    service.seed("contract_templates", [
      { id: "tpl-1", organization_id: "org-1", pdf_storage_path: null },
    ]);
    service.setError("rpc.hard_delete_contract_template", {
      message: "deadlock detected",
    });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("tpl-1"));
    expect(res.status).toBe(500);
  });
});
