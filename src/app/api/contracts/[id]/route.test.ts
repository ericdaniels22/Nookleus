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

// ---------- Supabase fake -----------------------------------------------
//
// Modeled on void/route.test.ts. Tracks: row reads via .from().select(),
// rpc calls, and storage ops. Slice #61 only deletes drafts so the
// payment-block + storage surface is scoped down to the minimum the
// route under test actually exercises. The voided branch (storage
// cleanup, payment-block) lands in slice #63 and will extend this fake.

type Row = Record<string, unknown>;
type PendingError = { message: string } | null;

interface FakeState {
  rows: Record<string, Row[]>;
  errors: Record<string, PendingError>;
  rpcCalls: { name: string; args: unknown }[];
  selectFromCalls: string[];
}

function makeServiceFake() {
  const state: FakeState = {
    rows: {},
    errors: {},
    rpcCalls: [],
    selectFromCalls: [],
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
          state.selectFromCalls.push(table);
          return selectBuilder(table, opts);
        },
      };
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

function makeRequest(): Request {
  return new Request("http://test/api/contracts/c-1", {
    method: "DELETE",
  });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ---------- Tests --------------------------------------------------------

describe("DELETE /api/contracts/[id] — draft branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeUnauthedFake() as never,
    );
    const service = makeServiceFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the contract is missing", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake() as never,
    );
    const service = makeServiceFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(404);
    expect(service.state.rpcCalls).toHaveLength(0);
  });

  it.each(["sent", "viewed", "signed", "expired", "voided"] as const)(
    "returns 409 when contract status is %s (only draft is deletable in #61)",
    async (status) => {
      vi.mocked(createServerSupabaseClient).mockResolvedValue(
        makeAuthedFake() as never,
      );
      const service = makeServiceFake();
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
    const service = makeServiceFake();
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

  it("returns 500 when delete_contract RPC fails", async () => {
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
    service.setError("rpc.delete_contract", { message: "boom" });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(500);
  });
});
