// src/app/api/accounting/expenses/route.ts
import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { resolveRange, type RangePreset } from "@/lib/accounting/date-ranges";

async function getExpenses(request: Request, ctx: RequestContext) {
  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") ?? "last_30") as RangePreset;
  const categoryIds = url.searchParams.getAll("category");
  const vendorId = url.searchParams.get("vendor");
  const jobId = url.searchParams.get("job");
  const damageTypes = url.searchParams.getAll("damage_type");
  const submittedBy = url.searchParams.get("submitted_by");
  const range = resolveRange(preset);

  const supabase = ctx.supabase;

  let q = supabase.from("expenses").select(`
    id, job_id, vendor_id, vendor_name, category_id, amount, expense_date,
    payment_method, description, receipt_path, thumbnail_path,
    submitted_by, submitter_name, created_at,
    expense_categories(name, display_label, bg_color, text_color),
    jobs(id, job_number, property_address, damage_type)
  `);
  if (range.startISO) q = q.gte("expense_date", range.startISO);
  if (range.endISO)   q = q.lte("expense_date", range.endISO);
  if (categoryIds.length) q = q.in("category_id", categoryIds);
  if (vendorId)          q = q.eq("vendor_id", vendorId);
  if (jobId)             q = q.eq("job_id", jobId);
  if (submittedBy)       q = q.eq("submitted_by", submittedBy);
  q = q.order("expense_date", { ascending: false });

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // damage_type filter applied in JS because it's a join column.
  type Row = {
    id: string;
    job_id: string;
    amount: number;
    jobs: { damage_type: string | null } | null;
  };
  let rows = (data ?? []) as unknown as Row[];
  if (damageTypes.length) {
    rows = rows.filter((r) => r.jobs && damageTypes.includes(r.jobs.damage_type ?? ""));
  }

  const total = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const uniqueJobs = new Set(rows.map((r) => r.job_id)).size;

  return NextResponse.json({
    rows,
    summary: { total, count: rows.length, jobs: uniqueJobs },
    range: { preset: range.preset, label: range.label },
  });
}

export const GET = withRequestContext(
  { permission: "view_accounting" },
  getExpenses,
);
