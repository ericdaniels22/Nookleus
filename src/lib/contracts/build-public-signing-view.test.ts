import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./resolve-merge-values", () => ({
  resolveMergeValues: vi.fn(async () => ({})),
}));

import { buildPublicSigningViewForContract } from "./build-public-signing-view";
import { makeSupabaseFake } from "./__test-utils__/supabase-fake";

// #76 graceful degradation: a `signed` contract is its own stamped PDF and
// survives the permanent deletion of its source template. The FK ON DELETE
// SET NULL nulls contracts.template_id; buildPublicSigningView must then
// build a usable view from the contract's signed_pdf_path instead of
// erroring with template_not_found.

function seedSigner(service: ReturnType<typeof makeSupabaseFake>, contractId: string) {
  service.seed("contract_signers", [
    {
      id: "signer-1",
      contract_id: contractId,
      signer_order: 1,
      name: "Jane Customer",
      role_label: "Customer",
      signed_at: "2026-05-10T00:00:00Z",
    },
  ]);
}

describe("buildPublicSigningViewForContract — deleted-template degradation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a view backed by signed_pdf_path for a signed contract whose template was deleted", async () => {
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        organization_id: "org-1",
        job_id: "job-1",
        template_id: null, // FK nulled by the template hard-delete
        title: "Roof Replacement Agreement",
        status: "signed",
        signed_at: "2026-05-10T00:00:00Z",
        signed_pdf_path: "org-1/contracts/c-1/signed.pdf",
        filled_content_html: "",
        customer_inputs: null,
        link_token: null,
        link_expires_at: null,
      },
    ]);
    seedSigner(service, "c-1");

    const result = await buildPublicSigningViewForContract(
      service.client as never,
      "c-1",
      "signer-1",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.template).toBeNull();
    expect(result.view.contract.signed_pdf_path).toBe("org-1/contracts/c-1/signed.pdf");
    expect(result.view.contract.status).toBe("signed");
    // The contract template was never consulted — template_id is null.
    expect(service.state.selectFromCalls).not.toContain("contract_templates");
  });

  it("still errors with template_not_found for an in-flight contract whose template is missing", async () => {
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-2",
        organization_id: "org-1",
        job_id: "job-1",
        template_id: "tpl-gone",
        title: "Pending Agreement",
        status: "viewed",
        signed_at: null,
        signed_pdf_path: null,
        filled_content_html: "",
        customer_inputs: null,
        link_token: null,
        link_expires_at: null,
      },
    ]);
    seedSigner(service, "c-2");

    const result = await buildPublicSigningViewForContract(
      service.client as never,
      "c-2",
      "signer-1",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("template_not_found");
  });
});
