// src/lib/accounting/margins.ts
// Job margin math. Per design spec:
// - collected = sum(payments.amount) WHERE status = 'received'
// - expenses  = sum(expenses.amount)
// - crew_labor = jobs.estimated_crew_labor_cost ?? 0
// - gross_margin = collected - expenses - crew_labor
// - margin_pct = (gross_margin / collected) * 100, or null if collected = 0
// - in_progress = job_status !== 'completed'
//
// Active jobs show the margin with an "(in progress)" indicator because
// mid-job numbers are misleading (expenses landed but collections haven't).

import { createServerSupabaseClient } from "@/lib/supabase-server";
export { marginPctBand, type MarginBand } from "./margin-bands";

export type JobMargin = {
  jobId: string;
  jobNumber: string | null;
  invoiced: number;
  collected: number;
  expenses: number;
  crew_labor: number;
  gross_margin: number;
  margin_pct: number | null;
  job_status: string;
  in_progress: boolean;
  crew_labor_is_estimated: boolean;
};

function sum<T>(rows: T[] | null | undefined, pick: (r: T) => number | null): number {
  if (!rows) return 0;
  let total = 0;
  for (const r of rows) total += pick(r) ?? 0;
  return total;
}

export async function calculateJobMargin(jobId: string): Promise<JobMargin> {
  const supabase = await createServerSupabaseClient();

  const [jobRes, invoicesRes, paymentsRes, expensesRes] = await Promise.all([
    supabase.from("jobs").select("id, job_number, status, estimated_crew_labor_cost").eq("id", jobId).maybeSingle(),
    supabase.from("invoices").select("total_amount").eq("job_id", jobId).is("deleted_at", null),
    supabase.from("payments").select("amount").eq("job_id", jobId).eq("status", "received"),
    supabase.from("expenses").select("amount").eq("job_id", jobId),
  ]);

  if (!jobRes.data) throw new Error(`Job ${jobId} not found`);

  const invoiced = sum(invoicesRes.data, (r: any) => Number(r.total_amount));
  const collected = sum(paymentsRes.data, (r: any) => Number(r.amount));
  const expenses = sum(expensesRes.data, (r: any) => Number(r.amount));
  const crew_labor = Number(jobRes.data.estimated_crew_labor_cost ?? 0);
  const gross_margin = collected - expenses - crew_labor;
  const margin_pct = collected > 0 ? (gross_margin / collected) * 100 : null;
  const job_status = jobRes.data.status;
  const in_progress = job_status !== "completed";

  return {
    jobId,
    jobNumber: jobRes.data.job_number,
    invoiced,
    collected,
    expenses,
    crew_labor,
    gross_margin,
    margin_pct,
    job_status,
    in_progress,
    crew_labor_is_estimated: crew_labor > 0 && in_progress,
  };
}

// Batch version used by /accounting Job Profitability tab.
// Returns one JobMargin row per job that has ANY activity in the date range
// (invoice, payment, or expense), per activity-based scoping rule.
export type MarginFilter = "all" | "active" | "completed";

export async function aggregateMargins(
  startISO: string | null,
  endISO: string | null,
  filter: MarginFilter,
): Promise<JobMargin[]> {
  const supabase = await createServerSupabaseClient();

  // Activity-based scoping: a job is in scope if it has an invoice, payment,
  // or expense in the range. When startISO/endISO are null (All time), skip filtering.
  // We do this as a single round-trip by fetching all 4 tables in parallel and
  // joining in JS. This keeps the SQL simple and sidesteps needing new RPCs.

  const [jobsRes, invoicesRes, paymentsRes, expensesRes] = await Promise.all([
    supabase.from("jobs").select("id, job_number, status, estimated_crew_labor_cost, damage_type, property_address"),
    supabase.from("invoices").select("job_id, total_amount, issued_date").is("deleted_at", null),
    supabase.from("payments").select("job_id, amount, received_date, status"),
    supabase.from("expenses").select("job_id, amount, expense_date"),
  ]);

  const inRange = (iso: string | null) => {
    if (!iso) return false;
    if (startISO && iso < startISO) return false;
    if (endISO && iso > endISO) return false;
    return true;
  };

  const activeJobIds = new Set<string>();
  if (startISO || endISO) {
    for (const i of invoicesRes.data ?? []) if (inRange(i.issued_date)) activeJobIds.add(i.job_id);
    for (const p of paymentsRes.data ?? []) if (p.status === "received" && inRange(p.received_date)) activeJobIds.add(p.job_id);
    for (const e of expensesRes.data ?? []) if (inRange(e.expense_date)) activeJobIds.add(e.job_id);
  } else {
    for (const j of jobsRes.data ?? []) activeJobIds.add(j.id);
  }

  const invByJob = new Map<string, number>();
  const colByJob = new Map<string, number>();
  const expByJob = new Map<string, number>();
  for (const i of invoicesRes.data ?? []) invByJob.set(i.job_id, (invByJob.get(i.job_id) ?? 0) + Number(i.total_amount ?? 0));
  for (const p of paymentsRes.data ?? []) {
    if (p.status === "received") colByJob.set(p.job_id, (colByJob.get(p.job_id) ?? 0) + Number(p.amount ?? 0));
  }
  for (const e of expensesRes.data ?? []) expByJob.set(e.job_id, (expByJob.get(e.job_id) ?? 0) + Number(e.amount ?? 0));

  const out: JobMargin[] = [];
  for (const job of jobsRes.data ?? []) {
    if (!activeJobIds.has(job.id)) continue;
    if (filter === "active" && job.status === "completed") continue;
    if (filter === "completed" && job.status !== "completed") continue;

    const invoiced = invByJob.get(job.id) ?? 0;
    const collected = colByJob.get(job.id) ?? 0;
    const expenses = expByJob.get(job.id) ?? 0;
    const crew_labor = Number(job.estimated_crew_labor_cost ?? 0);
    const gross_margin = collected - expenses - crew_labor;
    const margin_pct = collected > 0 ? (gross_margin / collected) * 100 : null;
    const in_progress = job.status !== "completed";

    out.push({
      jobId: job.id,
      jobNumber: job.job_number,
      invoiced, collected, expenses, crew_labor, gross_margin, margin_pct,
      job_status: job.status,
      in_progress,
      crew_labor_is_estimated: crew_labor > 0 && in_progress,
    });
  }

  return out;
}

// Color band for Margin % — re-exported at the top of this file from ./margin-bands
// (client-safe module). Kept here for backward compat with server imports.
