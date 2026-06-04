import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { calculateJobMargin, aggregateMargins } from "./margins";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { fakeServiceClient } from "../../app/api/__test-utils__/request-context-fakes";

type Row = Record<string, unknown>;

function mockSupabase(tables: Record<string, Row[]>) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeServiceClient({ tables }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// #383 — the Job "Invoiced" total must count only official invoices
// (sent/partial/paid). Drafts and voided are not real bills and must be
// excluded, fixing the latent over-count where every non-deleted invoice
// was summed.
describe("calculateJobMargin — Invoiced counts only official invoices", () => {
  it("sums sent/partial/paid and excludes draft/voided", async () => {
    mockSupabase({
      jobs: [
        { id: "job-1", job_number: "J-1", status: "completed", estimated_crew_labor_cost: 0 },
      ],
      invoices: [
        { job_id: "job-1", status: "sent", total_amount: 100, deleted_at: null },
        { job_id: "job-1", status: "partial", total_amount: 50, deleted_at: null },
        { job_id: "job-1", status: "paid", total_amount: 25, deleted_at: null },
        { job_id: "job-1", status: "draft", total_amount: 999, deleted_at: null },
        { job_id: "job-1", status: "voided", total_amount: 777, deleted_at: null },
      ],
      payments: [],
      expenses: [],
    });

    const margin = await calculateJobMargin("job-1");

    expect(margin.invoiced).toBe(175); // 100 + 50 + 25 — not 999 or 777
  });
});

// #383 — the org-wide profitability roll-up must use the same official-only
// rule so job and company numbers agree. Per-job Invoiced excludes draft/voided,
// and a job whose only activity is a draft drops out of the report entirely
// (no real bill, no payment, no expense → out of scope).
describe("aggregateMargins — profitability counts only official invoices", () => {
  it("excludes draft/voided from Invoiced and drops draft-only jobs from scope", async () => {
    mockSupabase({
      jobs: [
        { id: "job-1", job_number: "J-1", status: "completed", estimated_crew_labor_cost: 0 },
        { id: "job-2", job_number: "J-2", status: "completed", estimated_crew_labor_cost: 0 },
        { id: "job-3", job_number: "J-3", status: "completed", estimated_crew_labor_cost: 0 },
      ],
      invoices: [
        { job_id: "job-1", status: "sent", total_amount: 100, issued_date: "2026-05-01", deleted_at: null },
        { job_id: "job-1", status: "draft", total_amount: 999, issued_date: "2026-05-01", deleted_at: null },
        { job_id: "job-1", status: "voided", total_amount: 777, issued_date: "2026-05-01", deleted_at: null },
        { job_id: "job-2", status: "paid", total_amount: 200, issued_date: "2026-05-01", deleted_at: null },
        { job_id: "job-3", status: "draft", total_amount: 500, issued_date: "2026-05-01", deleted_at: null },
      ],
      payments: [],
      expenses: [],
    });

    const rows = await aggregateMargins("2026-01-01", "2026-12-31", "all");

    const byId = new Map(rows.map((r) => [r.jobId, r]));
    expect(byId.get("job-1")?.invoiced).toBe(100); // sent only — not 1876
    expect(byId.get("job-2")?.invoiced).toBe(200); // paid
    expect(byId.has("job-3")).toBe(false); // draft-only job is not a real bill
  });
});
