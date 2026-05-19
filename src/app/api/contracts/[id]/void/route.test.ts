import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/contracts/pdf-void-watermark", () => ({
  stampVoidWatermark: vi.fn(async () => new Uint8Array([0xff, 0xee, 0xdd])),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  makeSupabaseFake,
  makeAuthedFake,
  makeUnauthedFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

function makeRequest(body: unknown = {}): Request {
  return new Request("http://test/api/contracts/c-1/void", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ---------- Tests --------------------------------------------------------

describe("POST /api/contracts/[id]/void — sidecar watermark", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeUnauthedFake() as never,
    );
    const service = makeSupabaseFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the contract is missing", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const service = makeSupabaseFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(404);
  });

  it("returns 409 when the contract is already voided", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "voided",
        signed_pdf_path: null,
      },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(409);
  });

  it("returns 409 when the job has payments on record", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "sent",
        signed_pdf_path: null,
      },
    ]);
    service.seed("invoices", [{ id: "inv-1", job_id: "job-1" }]);
    service.seed("payments", [{ id: "pay-1", invoice_id: "inv-1" }]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(409);
    expect(service.state.rpcCalls).toHaveLength(0);
  });

  it("voiding a draft contract does not touch storage", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
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
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(200);
    expect(service.state.storageDownloads).toHaveLength(0);
    expect(service.state.storageUploads).toHaveLength(0);
    expect(service.state.rpcCalls).toEqual([
      {
        name: "void_contract",
        args: {
          p_contract_id: "c-1",
          p_voided_by: "user-1",
          p_reason: null,
        },
      },
    ]);
  });

  it("voiding a sent contract does not touch storage", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "sent",
        signed_pdf_path: null,
      },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest({ reason: "wrong customer" }), paramsFor("c-1"));
    expect(res.status).toBe(200);
    expect(service.state.storageDownloads).toHaveLength(0);
    expect(service.state.storageUploads).toHaveLength(0);
    expect(service.state.rpcCalls[0]).toMatchObject({
      name: "void_contract",
      args: { p_reason: "wrong customer" },
    });
  });

  it("voiding a signed contract uploads stamped bytes to the sidecar key and leaves the canonical key untouched", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const service = makeSupabaseFake();
    const canonicalPath = "org-1/contracts/c-1-signed.pdf";
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "signed",
        signed_pdf_path: canonicalPath,
      },
    ]);
    service.seedBlob(
      `contracts/${canonicalPath}`,
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    );
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest({ reason: "wrong file" }), paramsFor("c-1"));
    expect(res.status).toBe(200);

    expect(service.state.storageDownloads).toEqual([
      { bucket: "contracts", path: canonicalPath },
    ]);

    expect(service.state.storageUploads).toHaveLength(1);
    expect(service.state.storageUploads[0]).toMatchObject({
      bucket: "contracts",
      path: `${canonicalPath}.voided.pdf`,
      bytes: new Uint8Array([0xff, 0xee, 0xdd]),
    });

    const overwroteCanonical = service.state.storageUploads.some(
      (u) => u.path === canonicalPath,
    );
    expect(overwroteCanonical).toBe(false);

    expect(service.state.rpcCalls[0]).toMatchObject({
      name: "void_contract",
      args: {
        p_contract_id: "c-1",
        p_voided_by: "user-1",
        p_reason: "wrong file",
      },
    });
  });

  it("voids a signed contract with a missing canonical PDF: soft-skips sidecar, calls RPC, does NOT 500", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const service = makeSupabaseFake();
    const canonicalPath = "orgs/o/contracts/c-1/signed.pdf";
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "signed",
        signed_pdf_path: canonicalPath,
      },
    ]);
    // NOTE: no seedBlob — the fake will return { error: 'not found: ...' }
    // for the canonical download, simulating prod orphan rows.
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest({ reason: "stale row" }), paramsFor("c-1"));
    expect(res.status).toBe(200);

    // Download attempted (we tried), but no upload happened.
    expect(service.state.storageDownloads).toEqual([
      { bucket: "contracts", path: canonicalPath },
    ]);
    expect(service.state.storageUploads).toHaveLength(0);

    // RPC still fired — the void itself is the load-bearing action.
    expect(service.state.rpcCalls[0]).toMatchObject({
      name: "void_contract",
      args: { p_contract_id: "c-1", p_reason: "stale row" },
    });
  });

  it("returns 500 when the sidecar upload fails", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const service = makeSupabaseFake();
    const canonicalPath = "org-1/contracts/c-1-signed.pdf";
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "signed",
        signed_pdf_path: canonicalPath,
      },
    ]);
    service.seedBlob(
      `contracts/${canonicalPath}`,
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    );
    service.setError("storage.contracts.upload", {
      message: "quota exceeded",
    });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(500);
    // RPC must not have been called when the sidecar write failed.
    expect(service.state.rpcCalls).toHaveLength(0);
  });
});

// #106 — voiding a contract requires `edit_jobs` (contracts are gated on
// the job permissions). Admin coverage is the rest of this file: every
// test above authenticates as an admin, who auto-passes the rule.
describe("POST /api/contracts/[id]/void — permission gate (#106)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when the caller holds only view_jobs", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["view_jobs"] }) as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      { id: "c-1", job_id: "job-1", status: "draft", signed_pdf_path: null },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(403);
    // The wrapper rejected before the handler ran — no RPC.
    expect(service.state.rpcCalls).toHaveLength(0);
  });

  it("allows a member holding edit_jobs to void", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["edit_jobs"] }) as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      { id: "c-1", job_id: "job-1", status: "draft", signed_pdf_path: null },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(200);
    expect(service.state.rpcCalls[0]).toMatchObject({ name: "void_contract" });
  });
});
