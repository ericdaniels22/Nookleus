// src/app/api/accounting/summary/route.ts
import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { resolveRange, computeDelta, type RangePreset } from "@/lib/accounting/date-ranges";

async function getSummary(request: Request, ctx: RequestContext) {
  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") ?? "last_30") as RangePreset;
  const range = resolveRange(preset);

  const supabase = ctx.supabase;

  // Helper: fetch revenue + expenses sums for a date window.
  const fetchWindow = async (startISO: string | null, endISO: string | null) => {
    let payQ = supabase.from("payments").select("amount, received_date").eq("status", "received");
    let expQ = supabase.from("expenses").select("amount, expense_date");
    if (startISO) { payQ = payQ.gte("received_date", startISO); expQ = expQ.gte("expense_date", startISO); }
    if (endISO)   { payQ = payQ.lte("received_date", endISO);   expQ = expQ.lte("expense_date", endISO); }
    const [pay, exp] = await Promise.all([payQ, expQ]);
    const revenue = (pay.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const expenses = (exp.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
    return { revenue, expenses };
  };

  const [current, prior] = await Promise.all([
    fetchWindow(range.startISO, range.endISO),
    range.priorStartISO ? fetchWindow(range.priorStartISO, range.priorEndISO) : Promise.resolve({ revenue: 0, expenses: 0 }),
  ]);

  // Crew labor sum: sum estimated_crew_labor_cost for jobs that had received
  // payments inside the current range (approximation; per-job exact margins live
  // on the profitability tab).
  let crewLabor = 0;
  {
    let payJobsQ = supabase.from("payments").select("job_id").eq("status", "received");
    if (range.startISO) payJobsQ = payJobsQ.gte("received_date", range.startISO);
    if (range.endISO)   payJobsQ = payJobsQ.lte("received_date", range.endISO);
    const { data: payJobs } = await payJobsQ;
    const jobIds = Array.from(new Set((payJobs ?? []).map((r) => r.job_id))).filter(Boolean);
    if (jobIds.length > 0) {
      const { data: jobs } = await supabase.from("jobs").select("estimated_crew_labor_cost").in("id", jobIds);
      crewLabor = (jobs ?? []).reduce((s, j) => s + Number(j.estimated_crew_labor_cost ?? 0), 0);
    }
  }

  const grossMargin = current.revenue - current.expenses - crewLabor;
  const marginPct = current.revenue > 0 ? (grossMargin / current.revenue) * 100 : null;
  const expensesPctOfRevenue = current.revenue > 0 ? (current.expenses / current.revenue) * 100 : null;
  const revenueDelta = range.priorStartISO ? computeDelta(current.revenue, prior.revenue) : null;

  // Outstanding AR: invoices not paid/draft, total - received-on-invoice.
  const { data: allInvoices } = await supabase.from("invoices").select("id, total_amount, status, issued_date").is("deleted_at", null);
  const { data: allPayments } = await supabase.from("payments").select("invoice_id, amount").eq("status", "received");
  const paidByInvoice = new Map<string, number>();
  for (const p of allPayments ?? []) {
    if (p.invoice_id) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount ?? 0));
  }
  let outstandingAR = 0;
  let overSixtyAR = 0;
  const today = new Date();
  const sixtyDaysAgo = new Date(today); sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  for (const inv of allInvoices ?? []) {
    if (inv.status === "paid" || inv.status === "draft") continue;
    const outstanding = Number(inv.total_amount ?? 0) - (paidByInvoice.get(inv.id) ?? 0);
    if (outstanding <= 0) continue;
    outstandingAR += outstanding;
    if (inv.issued_date && new Date(inv.issued_date) < sixtyDaysAgo) overSixtyAR += outstanding;
  }

  return NextResponse.json({
    range: { preset: range.preset, startISO: range.startISO, endISO: range.endISO, label: range.label },
    revenue: { current: current.revenue, prior: prior.revenue, delta: revenueDelta },
    expenses: { current: current.expenses, pctOfRevenue: expensesPctOfRevenue },
    grossMargin: { amount: grossMargin, pct: marginPct, crew_labor: crewLabor },
    outstandingAR: { amount: outstandingAR, overSixty: overSixtyAR },
  });
}

export const GET = withRequestContext({ permission: "view_accounting" }, getSummary);
