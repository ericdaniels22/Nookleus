import { describe, it, expect, vi, beforeEach } from "vitest";

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

function makeRequest(): Request {
  return new Request("http://test/api/contracts/c-1/restore", {
    method: "POST",
  });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/contracts/[id]/restore — auth", () => {
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
});

describe("POST /api/contracts/[id]/restore — load contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the contract is missing", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const service = makeSupabaseFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(404);
    expect(service.state.rpcCalls).toHaveLength(0);
  });
});

describe("POST /api/contracts/[id]/restore — status guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["draft", "sent", "viewed", "signed", "expired"] as const)(
    "returns 409 when contract status is %s (only voided can be restored)",
    async (status) => {
      vi.mocked(createServerSupabaseClient).mockResolvedValue(
        makeAuthedFake("user-1", { role: "admin" }) as never,
      );
      const service = makeSupabaseFake();
      service.seed("contracts", [
        {
          id: "c-1",
          job_id: "job-1",
          status,
          signed_at: null,
          first_viewed_at: null,
          sent_at: null,
        },
      ]);
      vi.mocked(createServiceClient).mockReturnValue(service.client as never);

      const res = await POST(makeRequest(), paramsFor("c-1"));
      expect(res.status).toBe(409);
      expect(service.state.rpcCalls).toHaveLength(0);
    },
  );
});

describe("POST /api/contracts/[id]/restore — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores a voided contract via restore_contract RPC and leaves storage untouched", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-7", { role: "admin" }) as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "voided",
        // Signed contract that got voided — canonical PDF was preserved by
        // slice #60's sidecar-watermark flow. Restore should not re-read or
        // re-upload anything in storage.
        signed_at: "2026-05-13T12:00:00Z",
        first_viewed_at: "2026-05-13T11:00:00Z",
        sent_at: "2026-05-13T10:00:00Z",
      },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(200);

    expect(service.state.rpcCalls).toEqual([
      {
        name: "restore_contract",
        args: { p_contract_id: "c-1", p_restored_by: "user-7" },
      },
    ]);

    // Restore is metadata-only at the storage layer; canonical signed PDF
    // stays exactly where it was.
    expect(service.state.storageDownloads).toHaveLength(0);
    expect(service.state.storageUploads).toHaveLength(0);
  });

  it("returns 500 when restore_contract RPC fails", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "voided",
        signed_at: null,
        first_viewed_at: null,
        sent_at: "2026-05-13T10:00:00Z",
      },
    ]);
    service.setError("rpc.restore_contract", { message: "boom" });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(500);
  });
});

// #106 — restoring a contract requires `edit_jobs` (contracts are gated on
// the job permissions). Every test above authenticates as an admin, who
// auto-passes the rule.
describe("POST /api/contracts/[id]/restore — permission gate (#106)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when the caller holds only view_jobs", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["view_jobs"] }) as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "voided",
        signed_at: null,
        first_viewed_at: null,
        sent_at: "2026-05-13T10:00:00Z",
      },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(403);
    expect(service.state.rpcCalls).toHaveLength(0);
  });

  it("allows a member holding edit_jobs to restore", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["edit_jobs"] }) as never,
    );
    const service = makeSupabaseFake();
    service.seed("contracts", [
      {
        id: "c-1",
        job_id: "job-1",
        status: "voided",
        signed_at: null,
        first_viewed_at: null,
        sent_at: "2026-05-13T10:00:00Z",
      },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(200);
    expect(service.state.rpcCalls[0]).toMatchObject({ name: "restore_contract" });
  });
});
