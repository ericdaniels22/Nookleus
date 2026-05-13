import { describe, it, expect } from "vitest";
import {
  assertJobHasNoPayments,
  JobHasPaymentsError,
} from "./payment-block";

interface FakeState {
  invoices: { id: string; job_id: string }[];
  paymentsByInvoice: Record<string, number>;
}

function makeFake(seed: Partial<FakeState> = {}) {
  const state: FakeState = {
    invoices: seed.invoices ?? [],
    paymentsByInvoice: seed.paymentsByInvoice ?? {},
  };

  function selectInvoices() {
    const filters: Record<string, unknown> = {};
    const builder = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return builder;
      },
      then(
        resolve: (v: { data: unknown; error: null }) => unknown,
      ): unknown {
        const rows = state.invoices.filter((r) =>
          Object.entries(filters).every(
            ([k, v]) => (r as Record<string, unknown>)[k] === v,
          ),
        );
        return resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  function selectPayments() {
    const filters: Record<string, unknown[]> = {};
    const builder = {
      in(col: string, vals: unknown[]) {
        filters[col] = vals;
        return builder;
      },
      then(
        resolve: (v: {
          data: unknown;
          error: null;
          count: number | null;
        }) => unknown,
      ): unknown {
        const ids = (filters.invoice_id ?? []) as string[];
        let count = 0;
        for (const id of ids) {
          count += state.paymentsByInvoice[id] ?? 0;
        }
        return resolve({ data: null, error: null, count });
      },
    };
    return builder;
  }

  const client = {
    from(table: string) {
      return {
        select(_cols: string, _opts?: unknown) {
          void _cols;
          void _opts;
          if (table === "invoices") return selectInvoices();
          if (table === "payments") return selectPayments();
          throw new Error(`unexpected table: ${table}`);
        },
      };
    },
  };

  return { client, state };
}

describe("assertJobHasNoPayments", () => {
  it("resolves when the job has no invoices", async () => {
    const fake = makeFake();
    await expect(
      assertJobHasNoPayments(fake.client as never, "job-1"),
    ).resolves.toBeUndefined();
  });

  it("resolves when invoices exist but no payments are recorded", async () => {
    const fake = makeFake({
      invoices: [{ id: "inv-1", job_id: "job-1" }],
      paymentsByInvoice: {},
    });
    await expect(
      assertJobHasNoPayments(fake.client as never, "job-1"),
    ).resolves.toBeUndefined();
  });

  it("throws JobHasPaymentsError when any invoice on the job has a payment", async () => {
    const fake = makeFake({
      invoices: [
        { id: "inv-1", job_id: "job-1" },
        { id: "inv-2", job_id: "job-1" },
      ],
      paymentsByInvoice: { "inv-2": 1 },
    });
    await expect(
      assertJobHasNoPayments(fake.client as never, "job-1"),
    ).rejects.toBeInstanceOf(JobHasPaymentsError);
  });

  it("does not run the payments query when the job has no invoices", async () => {
    let paymentsQueried = false;
    const fake = makeFake();
    // Wrap the .from to track when payments is queried.
    const originalFrom = fake.client.from;
    fake.client.from = (table: string) => {
      if (table === "payments") paymentsQueried = true;
      return originalFrom(table);
    };
    await assertJobHasNoPayments(fake.client as never, "job-1");
    expect(paymentsQueried).toBe(false);
  });
});
