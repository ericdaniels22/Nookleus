import { describe, expect, it } from "vitest";

import {
  advanceJobOnContractSigned,
  nextStatusOnContractSigned,
} from "./job-status-transitions";

// Issue #721 (PRD #719, ADR 0022) — finalizing a signed contract is the one
// automatic Job-status move: a Lead (`new`) or a Lost (`cancelled`) Job
// advances to Active (`in_progress`). Signing never moves a Job backward, so
// an Active/Collections/Closed Job is left untouched. The snake_case keys are
// frozen (ADR 0022); the decision branches on keys, never labels.

describe("nextStatusOnContractSigned", () => {
  it("advances a Lead (new) Job to Active (in_progress)", () => {
    expect(nextStatusOnContractSigned("new")).toBe("in_progress");
  });

  it("revives a Lost (cancelled) Job to Active (in_progress)", () => {
    expect(nextStatusOnContractSigned("cancelled")).toBe("in_progress");
  });

  // Signing never moves a Job backward: Active / Collections / Closed stay put.
  const noOp: Array<[string, string]> = [
    ["in_progress", "Active"],
    ["pending_invoice", "Collections"],
    ["completed", "Closed"],
  ];
  it.each(noOp)("leaves %s (%s) unchanged — no backward move", (key) => {
    expect(nextStatusOnContractSigned(key)).toBeNull();
  });

  it("no-ops on an unknown status key", () => {
    expect(nextStatusOnContractSigned("archived")).toBeNull();
    expect(nextStatusOnContractSigned("")).toBeNull();
  });
});

// ---------- jobs fake ----------------------------------------------------
//
// Minimal Supabase stand-in for the calls advanceJobOnContractSigned issues:
// `from("jobs").select("status").eq("id", …).maybeSingle()` and the guarded
// write `from("jobs").update({ status }).eq("id", …).eq("status", …)
// .select("status").maybeSingle()`. `.eq()` filters compose (id AND status),
// so a write only lands when the live row still matches every filter — the
// same atomic guard Postgres applies. Tracks update payloads + filters and
// mutates the seeded row so a follow-up read reflects the write. Errors can be
// injected per operation; `mutateAfterRead` flips the live row right after the
// read resolves to simulate a concurrent writer in the read→write window.

function makeJobsFake(
  initial: { id: string; status: string } | null,
  opts: {
    selectError?: boolean;
    updateError?: boolean;
    selectThrows?: boolean;
    updateThrows?: boolean;
    mutateAfterRead?: string;
  } = {},
) {
  const updates: Array<{
    values: Record<string, unknown>;
    filters: Record<string, unknown>;
  }> = [];
  const row = initial ? { ...initial } : null;

  function matches(filters: Record<string, unknown>): boolean {
    if (!row) return false;
    for (const [k, v] of Object.entries(filters)) {
      if ((row as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
  }

  const client = {
    from(_table: string) {
      void _table;
      return {
        select(_cols?: string) {
          void _cols;
          const filters: Record<string, unknown> = {};
          const b = {
            eq(c: string, v: unknown) {
              filters[c] = v;
              return b;
            },
            async maybeSingle() {
              if (opts.selectThrows) throw new Error("select rejected");
              if (opts.selectError) {
                return { data: null, error: { message: "select boom" } };
              }
              if (!matches(filters)) return { data: null, error: null };
              const snapshot = { ...(row as Record<string, unknown>) };
              if (opts.mutateAfterRead !== undefined && row) {
                row.status = opts.mutateAfterRead;
              }
              return { data: snapshot, error: null };
            },
          };
          return b;
        },
        update(values: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          function apply() {
            updates.push({ values, filters: { ...filters } });
            if (opts.updateThrows) throw new Error("update rejected");
            if (opts.updateError) {
              return { data: null, error: { message: "rls denied" } };
            }
            if (matches(filters) && row) {
              Object.assign(row, values);
              return { data: { ...row }, error: null };
            }
            return { data: null, error: null };
          }
          const b = {
            eq(c: string, v: unknown) {
              filters[c] = v;
              return b;
            },
            select(_cols?: string) {
              void _cols;
              return {
                async maybeSingle() {
                  return apply();
                },
              };
            },
            then(resolve: (r: unknown) => unknown) {
              return resolve(apply());
            },
          };
          return b;
        },
      };
    },
  };
  return { client, updates, getRow: () => row };
}

describe("advanceJobOnContractSigned", () => {
  it("advances a Lead (new) Job to in_progress and persists the write", async () => {
    const fake = makeJobsFake({ id: "job-1", status: "new" });

    const result = await advanceJobOnContractSigned(fake.client as never, "job-1");

    expect(result).toBe("in_progress");
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]).toMatchObject({
      values: { status: "in_progress" },
      filters: { id: "job-1" },
    });
    expect(fake.getRow()?.status).toBe("in_progress");
  });

  // The read and write are two statements: a concurrent writer (the #722 status
  // dropdown, or a sibling signing) can move the Job in the window between them.
  // The write must re-assert the status is unchanged so it can never clobber a
  // Job that has moved on — signing never moves a Job backward.
  it("does not clobber a Job whose status changed between the read and the write", async () => {
    const fake = makeJobsFake(
      { id: "job-race", status: "new" },
      { mutateAfterRead: "completed" },
    );

    const result = await advanceJobOnContractSigned(fake.client as never, "job-race");

    expect(result).toBeNull();
    expect(fake.getRow()?.status).toBe("completed");
  });

  it("revives a Lost (cancelled) Job to in_progress", async () => {
    const fake = makeJobsFake({ id: "job-lost", status: "cancelled" });

    const result = await advanceJobOnContractSigned(fake.client as never, "job-lost");

    expect(result).toBe("in_progress");
    expect(fake.getRow()?.status).toBe("in_progress");
  });

  it("leaves an Active (in_progress) Job untouched and issues no write", async () => {
    const fake = makeJobsFake({ id: "job-2", status: "in_progress" });

    const result = await advanceJobOnContractSigned(fake.client as never, "job-2");

    expect(result).toBeNull();
    expect(fake.updates).toHaveLength(0);
    expect(fake.getRow()?.status).toBe("in_progress");
  });

  it("no-ops on a null/empty jobId without touching the database", async () => {
    const fake = makeJobsFake({ id: "job-3", status: "new" });

    expect(await advanceJobOnContractSigned(fake.client as never, null)).toBeNull();
    expect(await advanceJobOnContractSigned(fake.client as never, undefined)).toBeNull();
    expect(await advanceJobOnContractSigned(fake.client as never, "")).toBeNull();
    expect(fake.updates).toHaveLength(0);
    expect(fake.getRow()?.status).toBe("new");
  });

  // Best-effort: a status hiccup must never break a legally-completed signing.
  it("returns null when the jobs update is rejected (does not report a false advance)", async () => {
    const fake = makeJobsFake({ id: "job-7", status: "new" }, { updateError: true });

    const result = await advanceJobOnContractSigned(fake.client as never, "job-7");

    expect(result).toBeNull();
  });

  it("returns null when the jobs read returns an error", async () => {
    const fake = makeJobsFake({ id: "job-8", status: "new" }, { selectError: true });

    const result = await advanceJobOnContractSigned(fake.client as never, "job-8");

    expect(result).toBeNull();
    expect(fake.updates).toHaveLength(0);
  });

  it("swallows a thrown DB failure and resolves to null instead of propagating", async () => {
    const reading = makeJobsFake({ id: "job-9", status: "new" }, { selectThrows: true });
    await expect(
      advanceJobOnContractSigned(reading.client as never, "job-9"),
    ).resolves.toBeNull();

    const writing = makeJobsFake({ id: "job-10", status: "new" }, { updateThrows: true });
    await expect(
      advanceJobOnContractSigned(writing.client as never, "job-10"),
    ).resolves.toBeNull();
  });
});
