// src/app/api/accounting/export/[type]/route.ts
// CSV and ZIP downloads for accounting reports.
// type ∈ { profitability, ar-aging, expenses, all }
// ?range=<preset>  (last_30 | this_quarter | ytd | all_time)

import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireViewAccounting } from "@/lib/accounting/auth";
import { toCSV } from "@/lib/accounting/csv";
import { resolveRange, type RangePreset } from "@/lib/accounting/date-ranges";
import { aggregateMargins } from "@/lib/accounting/margins";
import { createServerSupabaseClient } from "@/lib/supabase-server";

async function buildProfitabilityCSV(preset: RangePreset): Promise<string> {
  const range = resolveRange(preset);
  const margins = await aggregateMargins(range.startISO, range.endISO, "all");
  const supabase = await createServerSupabaseClient();
  const { data: jobs } = margins.length
    ? await supabase
        .from("jobs")
        .select("id, job_number, property_address, damage_type")
        .in(
          "id",
          margins.map((m) => m.jobId),
        )
    : { data: [] };
  const jbid = new Map((jobs ?? []).map((j) => [j.id, j]));
  const headers = [
    "Job #",
    "Address",
    "Damage",
    "Status",
    "Invoiced",
    "Collected",
    "Expenses",
    "Crew labor",
    "Gross margin",
    "Margin %",
  ];
  const rows = margins.map((m) => {
    const j = jbid.get(m.jobId);
    return [
      j?.job_number ?? "",
      j?.property_address ?? "",
      j?.damage_type ?? "",
      m.job_status,
      m.invoiced,
      m.collected,
      m.expenses,
      m.crew_labor,
      m.gross_margin,
      m.margin_pct !== null ? m.margin_pct.toFixed(1) : "",
    ];
  });
  return toCSV(headers, rows);
}

async function buildArAgingCSV(): Promise<string> {
  const supabase = await createServerSupabaseClient();
  const [invRes, payRes] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, job_id, invoice_number, total_amount, status, issued_date")
      .is("deleted_at", null),
    supabase.from("payments").select("invoice_id, amount").eq("status", "received"),
  ]);
  const paidByInvoice = new Map<string, number>();
  for (const p of payRes.data ?? []) {
    if (p.invoice_id)
      paidByInvoice.set(
        p.invoice_id,
        (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount ?? 0),
      );
  }
  const unpaid = (invRes.data ?? [])
    .filter((i) => i.status !== "draft" && i.status !== "paid")
    .map((i) => ({
      ...i,
      outstanding: Number(i.total_amount ?? 0) - (paidByInvoice.get(i.id) ?? 0),
    }))
    .filter((i) => i.outstanding > 0);
  const jobIds = Array.from(new Set(unpaid.map((i) => i.job_id)));
  const { data: jobs } = jobIds.length
    ? await supabase
        .from("jobs")
        .select("id, job_number, property_address, payer_type")
        .in("id", jobIds)
    : { data: [] };
  const jobById = new Map((jobs ?? []).map((j) => [j.id, j]));
  const today = new Date();
  const headers = [
    "Invoice #",
    "Job #",
    "Address",
    "Payer",
    "Outstanding",
    "Age (days)",
    "Bucket",
    "Issued",
  ];
  const rows = unpaid.map((i) => {
    const j = jobById.get(i.job_id);
    const ageDays = i.issued_date
      ? Math.floor((today.getTime() - new Date(i.issued_date).getTime()) / 86400000)
      : 0;
    const bucket =
      ageDays <= 0
        ? "current"
        : ageDays <= 30
          ? "1-30"
          : ageDays <= 60
            ? "31-60"
            : ageDays <= 90
              ? "61-90"
              : "90+";
    return [
      i.invoice_number ?? "",
      j?.job_number ?? "",
      j?.property_address ?? "",
      j?.payer_type ?? "",
      i.outstanding,
      ageDays,
      bucket,
      i.issued_date ?? "",
    ];
  });
  return toCSV(headers, rows);
}

async function buildExpensesCSV(preset: RangePreset): Promise<string> {
  const range = resolveRange(preset);
  const supabase = await createServerSupabaseClient();
  let q = supabase.from("expenses").select(`
    expense_date, vendor_name, amount, description,
    jobs(job_number, property_address),
    expense_categories(name),
    submitter_name
  `);
  if (range.startISO) q = q.gte("expense_date", range.startISO);
  if (range.endISO) q = q.lte("expense_date", range.endISO);
  const { data } = await q;
  type ExpenseRow = {
    expense_date: string;
    vendor_name: string | null;
    amount: number;
    description: string | null;
    jobs: { job_number: string | null; property_address: string | null } | null;
    expense_categories: { name: string | null } | null;
    submitter_name: string | null;
  };
  const rows = (data ?? []) as unknown as ExpenseRow[];
  const headers = [
    "Date",
    "Vendor",
    "Category",
    "Amount",
    "Description",
    "Job #",
    "Job address",
    "Submitted by",
  ];
  const outRows = rows.map((r) => [
    r.expense_date,
    r.vendor_name ?? "",
    r.expense_categories?.name ?? "",
    r.amount,
    r.description ?? "",
    r.jobs?.job_number ?? "",
    r.jobs?.property_address ?? "",
    r.submitter_name ?? "",
  ]);
  return toCSV(headers, outRows);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const auth = await requireViewAccounting();
  if (!auth.ok) return auth.response;

  const { type } = await params;
  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") ?? "last_30") as RangePreset;

  if (type === "profitability") {
    const csv = await buildProfitabilityCSV(preset);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="profitability-${preset}.csv"`,
      },
    });
  }

  if (type === "ar-aging") {
    const csv = await buildArAgingCSV();
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ar-aging.csv"`,
      },
    });
  }

  if (type === "expenses") {
    const csv = await buildExpensesCSV(preset);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="expenses-${preset}.csv"`,
      },
    });
  }

  if (type === "all") {
    const zip = new JSZip();
    const [p, a, e] = await Promise.all([
      buildProfitabilityCSV(preset),
      buildArAgingCSV(),
      buildExpensesCSV(preset),
    ]);
    zip.file(`profitability-${preset}.csv`, p);
    zip.file(`ar-aging.csv`, a);
    zip.file(`expenses-${preset}.csv`, e);
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    return new Response(buf, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="accounting-${preset}.zip"`,
      },
    });
  }

  return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
}
