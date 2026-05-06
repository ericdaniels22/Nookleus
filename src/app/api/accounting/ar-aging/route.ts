// src/app/api/accounting/ar-aging/route.ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireViewAccounting } from "@/lib/accounting/auth";

type PayerFilter = "all" | "insurance" | "homeowner";

function ageBucket(days: number): "current" | "1-30" | "31-60" | "61-90" | "90+" {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export async function GET(request: Request) {
  const auth = await requireViewAccounting();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const payerFilter = (url.searchParams.get("payer") ?? "all") as PayerFilter;

  const supabase = await createServerSupabaseClient();
  const [invRes, payRes] = await Promise.all([
    supabase.from("invoices").select("id, job_id, invoice_number, total_amount, status, issued_date").is("deleted_at", null),
    supabase.from("payments").select("invoice_id, amount").eq("status", "received"),
  ]);

  const paidByInvoice = new Map<string, number>();
  for (const p of payRes.data ?? []) {
    if (p.invoice_id) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount ?? 0));
  }

  const unpaid = (invRes.data ?? [])
    .filter((i) => i.status !== "draft" && i.status !== "paid")
    .map((i) => ({ ...i, outstanding: Number(i.total_amount ?? 0) - (paidByInvoice.get(i.id) ?? 0) }))
    .filter((i) => i.outstanding > 0);

  const jobIds = Array.from(new Set(unpaid.map((i) => i.job_id)));
  const { data: jobs } = jobIds.length
    ? await supabase.from("jobs").select("id, job_number, property_address, payer_type, contact_id").in("id", jobIds)
    : { data: [] };
  const jobById = new Map((jobs ?? []).map((j) => [j.id, j]));

  // Last contact per job: most recent email ordered by received_at
  const lastEmailByJob = new Map<string, string>();
  if (jobIds.length) {
    const { data: emails } = await supabase
      .from("emails")
      .select("job_id, received_at")
      .in("job_id", jobIds)
      .order("received_at", { ascending: false });
    for (const e of emails ?? []) {
      if (!lastEmailByJob.has(e.job_id)) lastEmailByJob.set(e.job_id, e.received_at);
    }
  }

  const today = new Date();
  type Row = {
    invoiceId: string;
    jobId: string;
    jobNumber: string | null;
    jobAddress: string | null;
    invoiceNumber: string | null;
    payerType: string | null;
    outstanding: number;
    ageDays: number;
    bucket: string;
    lastContact: string | null;
  };
  const rows: Row[] = [];
  const buckets: Record<"current" | "1-30" | "31-60" | "61-90" | "90+", { total: number; count: number }> = {
    current: { total: 0, count: 0 },
    "1-30": { total: 0, count: 0 },
    "31-60": { total: 0, count: 0 },
    "61-90": { total: 0, count: 0 },
    "90+": { total: 0, count: 0 },
  };

  for (const i of unpaid) {
    const j = jobById.get(i.job_id);
    const payerType = j?.payer_type ?? null;
    if (payerFilter !== "all" && payerType !== payerFilter) continue;
    const issuedDate = i.issued_date ? new Date(i.issued_date) : null;
    const ageDays = issuedDate ? Math.floor((today.getTime() - issuedDate.getTime()) / 86400000) : 0;
    const bucket = ageBucket(ageDays);
    buckets[bucket].total += i.outstanding;
    buckets[bucket].count += 1;
    rows.push({
      invoiceId: i.id,
      jobId: i.job_id,
      jobNumber: j?.job_number ?? null,
      jobAddress: j?.property_address ?? null,
      invoiceNumber: i.invoice_number,
      payerType,
      outstanding: i.outstanding,
      ageDays,
      bucket,
      lastContact: lastEmailByJob.get(i.job_id) ?? null,
    });
  }

  rows.sort((a, b) => b.ageDays - a.ageDays);

  return NextResponse.json({ buckets, rows });
}
