import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  upsertInsightMetrics,
  listOrganizationInsights,
  type InsightMetricUpsert,
} from "./metrics-store";

// In-memory insight_metric fake. Keys rows by the conflict columns the store
// claims to use (parsed from onConflict) so an upsert with the same key
// REPLACES rather than appends — exactly what proves idempotency.
function makeMetricsDb() {
  const store = new Map<string, Record<string, unknown>>();
  let lastOnConflict: string | undefined;
  let upsertCalls = 0;

  const client = {
    from(table: string) {
      if (table !== "insight_metric") throw new Error(`unexpected table: ${table}`);
      return {
        async upsert(rows: Record<string, unknown>[], opts?: { onConflict?: string }) {
          upsertCalls += 1;
          lastOnConflict = opts?.onConflict;
          const cols = (opts?.onConflict ?? "").split(",").map((c) => c.trim());
          // Postgres rejects a single ON CONFLICT batch that carries the same
          // conflict key twice ("command cannot affect row a second time",
          // cardinality_violation). The fake mimics that so a colliding batch
          // can't hide behind last-write-wins.
          const seenThisBatch = new Set<string>();
          for (const row of rows) {
            const key = cols.map((c) => String(row[c])).join("|");
            if (seenThisBatch.has(key)) {
              throw new Error(
                "ON CONFLICT DO UPDATE command cannot affect row a second time",
              );
            }
            seenThisBatch.add(key);
            store.set(key, { ...row });
          }
          return { data: null, error: null };
        },
        // The read side: .select(...).eq("organization_id", id). The fake ignores
        // the column projection (the real query narrows it) and just enforces the
        // org filter, which is the scoping behavior under test.
        select() {
          return {
            eq(col: string, val: unknown) {
              const data = [...store.values()].filter((r) => r[col] === val);
              return Promise.resolve({ data, error: null });
            },
          };
        },
      };
    },
  };

  return {
    db: client as unknown as SupabaseClient,
    rows: () => [...store.values()] as unknown as InsightMetricUpsert[],
    get lastOnConflict() {
      return lastOnConflict;
    },
    get upsertCalls() {
      return upsertCalls;
    },
  };
}

function metric(overrides: Partial<InsightMetricUpsert> = {}): InsightMetricUpsert {
  return {
    organization_id: "org-1",
    source: "business_profile",
    metric_date: "2026-06-25",
    metric: "calls",
    value: 12,
    ...overrides,
  };
}

describe("upsertInsightMetrics", () => {
  it("upserts on the (organization_id, source, metric_date, metric) conflict target", async () => {
    const fake = makeMetricsDb();

    await upsertInsightMetrics(fake.db, [metric()]);

    expect(fake.lastOnConflict).toBe("organization_id,source,metric_date,metric");
    expect(fake.rows()).toHaveLength(1);
  });

  it("does not touch the table for an empty batch", async () => {
    const fake = makeMetricsDb();

    await upsertInsightMetrics(fake.db, []);

    expect(fake.upsertCalls).toBe(0);
    expect(fake.rows()).toHaveLength(0);
  });

  it("re-ingesting the same day's metric overwrites in place (idempotent)", async () => {
    const fake = makeMetricsDb();

    // First run: Google reports 12 calls for the day.
    await upsertInsightMetrics(fake.db, [metric({ value: 12 })]);
    // Second run re-pulls the same day; Google has since revised it to 15.
    await upsertInsightMetrics(fake.db, [metric({ value: 15 })]);

    const rows = fake.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(15);
  });

  it("keeps the same day's metrics from different sources as separate rows", async () => {
    const fake = makeMetricsDb();

    await upsertInsightMetrics(fake.db, [
      metric({ source: "business_profile", metric: "website_clicks", value: 40 }),
      metric({ source: "search_console", metric: "clicks", value: 88 }),
    ]);

    expect(fake.rows()).toHaveLength(2);
  });

  it("sums same-conflict-key rows in one batch into a single org-level row", async () => {
    const fake = makeMetricsDb();

    // Two Business Profile locations each report calls for the SAME org/day —
    // in the table they share the (org, source, day, metric) conflict key, so a
    // raw batch with both would trip Postgres' cardinality_violation. The store
    // collapses them into one row, summing the locations into the org-level total.
    const written = await upsertInsightMetrics(fake.db, [
      metric({ value: 12 }),
      metric({ value: 8 }),
    ]);

    const rows = fake.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(20);
    // The return value is the number of rows actually written (post-collapse),
    // so a multi-location ingest reports an accurate tally.
    expect(written).toBe(1);
  });
});

describe("listOrganizationInsights", () => {
  it("returns only the given Organization's dated metric rows", async () => {
    const fake = makeMetricsDb();
    await upsertInsightMetrics(fake.db, [
      metric({ organization_id: "org-1", metric: "calls", value: 12 }),
      metric({
        organization_id: "org-1",
        source: "search_console",
        metric: "clicks",
        value: 88,
      }),
      // A different Organization's row must never leak into the result.
      metric({ organization_id: "org-2", metric: "calls", value: 99 }),
    ]);

    const rows = await listOrganizationInsights(fake.db, "org-1");

    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(
      expect.objectContaining({
        source: "business_profile",
        metric_date: "2026-06-25",
        metric: "calls",
        value: 12,
      }),
    );
    expect(rows.some((r) => r.value === 99)).toBe(false);
  });
});
