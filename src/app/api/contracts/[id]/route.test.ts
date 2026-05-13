import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));

import { DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  makeSupabaseFake,
  makeAuthedFake,
  makeUnauthedFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

function makeRequest(): Request {
  return new Request("http://test/api/contracts/c-1", {
    method: "DELETE",
  });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ---------- Tests --------------------------------------------------------

describe("DELETE /api/contracts/[id] — draft + voided branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeUnauthedFake() as never,
    );
    const service = makeSupabaseFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the contract is missing", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake() as never,
    );
    const service = makeSupabaseFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(404);
    expect(service.state.rpcCalls).toHaveLength(0);
  });

  it.each(["sent", "viewed", "signed", "expired"] as const)(
    "returns 409 when contract status is %s (alive contracts must be voided first)",
    async (status) => {
      vi.mocked(createServerSupabaseClient).mockResolvedValue(
        makeAuthedFake() as never,
      );
      const service = makeSupabaseFake();
      service.seed("contracts", [
        {
          id: "c-1",
          job_id: "job-1",
          status,
          signed_pdf_path: null,
        },
      ]);
      vi.mocked(createServiceClient).mockReturnValue(service.client as never);

      const res = await DELETE(makeRequest(), paramsFor("c-1"));
      expect(res.status).toBe(409);
      expect(service.state.rpcCalls).toHaveLength(0);
    },
  );

  it("deletes a draft via delete_contract RPC without running the payment-block check", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake() as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "draft",
        signed_pdf_path: null,
      },
    ]);
    // Seed phantom invoice + payment to prove the route does NOT consult
    // them on the draft branch — drafts have no audit weight to protect.
    service.seed("invoices", [{ id: "inv-1", job_id: "job-1" }]);
    service.seed("payments", [{ id: "pay-1", invoice_id: "inv-1" }]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(200);

    expect(service.state.rpcCalls).toEqual([
      {
        name: "delete_contract",
        args: { p_contract_id: "c-1" },
      },
    ]);

    // The payment-block check would have queried `invoices` and `payments`.
    expect(service.state.selectFromCalls).not.toContain("invoices");
    expect(service.state.selectFromCalls).not.toContain("payments");
  });

  it("permanently deletes a voided contract: removes canonical + sidecar from storage, runs payment-block, then calls delete_contract RPC", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake() as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "voided",
        signed_pdf_path: "orgs/o/contracts/c-1/signed.pdf",
      },
    ]);
    // No invoices on this job — payment-block passes trivially.
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(200);

    // Payment-block must have run on the voided branch (positive assertion).
    expect(service.state.selectFromCalls).toContain("invoices");

    // Storage removal hits both keys, in the contracts bucket.
    expect(service.state.storageRemovals).toEqual([
      {
        bucket: "contracts",
        paths: [
          "orgs/o/contracts/c-1/signed.pdf",
          "orgs/o/contracts/c-1/signed.pdf.voided.pdf",
        ],
      },
    ]);

    // Single delete_contract RPC call follows storage cleanup.
    expect(service.state.rpcCalls).toEqual([
      {
        name: "delete_contract",
        args: { p_contract_id: "c-1" },
      },
    ]);
  });

  it("returns 409 when voided contract's job has recorded payments (payment-block fires)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake() as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "voided",
        signed_pdf_path: "orgs/o/contracts/c-1/signed.pdf",
      },
    ]);
    service.seed("invoices", [{ id: "inv-1", job_id: "job-1" }]);
    service.seed("payments", [{ id: "pay-1", invoice_id: "inv-1" }]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(409);
    expect(service.state.rpcCalls).toHaveLength(0);
    expect(service.state.storageRemovals).toHaveLength(0);
  });

  it("permanently deletes a voided-without-signed-PDF contract without touching storage", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake() as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "voided",
        // Voided before signing — no canonical to clean up.
        signed_pdf_path: null,
      },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(200);
    expect(service.state.storageRemovals).toHaveLength(0);
    expect(service.state.rpcCalls).toEqual([
      { name: "delete_contract", args: { p_contract_id: "c-1" } },
    ]);
  });

  it("returns 500 when storage.remove fails on a voided contract and does NOT call the RPC (storage-first order)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake() as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "voided",
        signed_pdf_path: "orgs/o/contracts/c-1/signed.pdf",
      },
    ]);
    service.setError("storage.contracts.remove", { message: "s3 boom" });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(500);
    expect(service.state.rpcCalls).toHaveLength(0);
  });

  it("returns 500 when delete_contract RPC fails", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake() as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "draft",
        signed_pdf_path: null,
      },
    ]);
    service.setError("rpc.delete_contract", { message: "boom" });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(500);
  });

  it("returns 500 when delete_contract RPC fails on the voided branch (storage already removed)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake() as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "voided",
        signed_pdf_path: "orgs/o/contracts/c-1/signed.pdf",
      },
    ]);
    service.setError("rpc.delete_contract", { message: "boom" });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(500);
    // Storage was removed first; blob is orphaned but the DB row survives
    // for a manual retry.
    expect(service.state.storageRemovals).toHaveLength(1);
  });
});
