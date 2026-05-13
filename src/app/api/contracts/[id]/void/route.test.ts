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

// ---------- Supabase fake -----------------------------------------------

type Row = Record<string, unknown>;
type PendingError = { message: string } | null;

interface FakeState {
  rows: Record<string, Row[]>;
  errors: Record<string, PendingError>;
  storageBlobs: Record<string, Uint8Array>;
  storageUploads: { bucket: string; path: string; bytes: Uint8Array; options?: unknown }[];
  storageDownloads: { bucket: string; path: string }[];
  rpcCalls: { name: string; args: unknown }[];
}

function makeServiceFake() {
  const state: FakeState = {
    rows: {},
    errors: {},
    storageBlobs: {},
    storageUploads: [],
    storageDownloads: [],
    rpcCalls: [],
  };

  function matchesFilters(row: Row, filters: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(filters)) {
      if (Array.isArray(v)) {
        if (!v.includes(row[k] as never)) return false;
      } else if (row[k] !== v) return false;
    }
    return true;
  }

  function selectBuilder(table: string, opts?: { count?: string; head?: boolean }) {
    const filters: Record<string, unknown> = {};
    const builder = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filters[col] = vals;
        return builder;
      },
      async maybeSingle() {
        const err = state.errors[`${table}.select`];
        if (err) return { data: null, error: err };
        const row = (state.rows[table] ?? []).find((r) =>
          matchesFilters(r, filters),
        );
        return { data: row ?? null, error: null };
      },
      then(
        resolve: (v: {
          data: unknown;
          error: PendingError;
          count?: number;
        }) => unknown,
      ): unknown {
        const err = state.errors[`${table}.select`];
        if (err) return resolve({ data: null, error: err });
        const rows = (state.rows[table] ?? []).filter((r) =>
          matchesFilters(r, filters),
        );
        if (opts?.count === "exact") {
          return resolve({ data: rows, error: null, count: rows.length });
        }
        return resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  const client = {
    from(table: string) {
      return {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          void _cols;
          return selectBuilder(table, opts);
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async download(path: string) {
            state.storageDownloads.push({ bucket, path });
            const err = state.errors[`storage.${bucket}.download`];
            if (err) return { data: null, error: err };
            const bytes = state.storageBlobs[`${bucket}/${path}`];
            if (!bytes) {
              return {
                data: null,
                error: { message: `not found: ${path}` },
              };
            }
            return {
              data: {
                async arrayBuffer() {
                  return bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength,
                  );
                },
              },
              error: null,
            };
          },
          async upload(path: string, data: Uint8Array, options?: unknown) {
            state.storageUploads.push({
              bucket,
              path,
              bytes: data,
              options,
            });
            const err = state.errors[`storage.${bucket}.upload`];
            if (err) return { data: null, error: err };
            return { data: { path }, error: null };
          },
        };
      },
    },
    async rpc(name: string, args: unknown) {
      state.rpcCalls.push({ name, args });
      const err = state.errors[`rpc.${name}`];
      if (err) return { data: null, error: err };
      return { data: null, error: null };
    },
  };

  return {
    client,
    state,
    seed(table: string, rows: Row[]) {
      state.rows[table] = state.rows[table] ?? [];
      state.rows[table].push(...rows);
    },
    seedBlob(key: string, bytes: Uint8Array) {
      state.storageBlobs[key] = bytes;
    },
    setError(key: string, err: PendingError) {
      state.errors[key] = err;
    },
  };
}

function makeAuthedFake(userId = "user-1") {
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: userId } }, error: null };
      },
    },
  };
}

function makeUnauthedFake() {
  return {
    auth: {
      async getUser() {
        return { data: { user: null }, error: { message: "no session" } };
      },
    },
  };
}

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
    const service = makeServiceFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the contract is missing", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake() as never,
    );
    const service = makeServiceFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(404);
  });

  it("returns 409 when the contract is already voided", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake() as never,
    );
    const service = makeServiceFake();
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
      makeAuthedFake() as never,
    );
    const service = makeServiceFake();
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
      makeAuthedFake() as never,
    );
    const service = makeServiceFake();
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
      makeAuthedFake() as never,
    );
    const service = makeServiceFake();
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
      makeAuthedFake() as never,
    );
    const service = makeServiceFake();
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

  it("returns 500 when the sidecar upload fails", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake() as never,
    );
    const service = makeServiceFake();
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
