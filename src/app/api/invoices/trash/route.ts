import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { purgeInvoiceStorage } from "@/lib/documents/purge";

const RETENTION_DAYS = 30;

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "view_invoices");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const jobId = url.searchParams.get("job_id");

  const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let expiredQuery = supabase
    .from("invoices")
    .select("id, organization_id, invoice_number")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoffIso);
  if (jobId) expiredQuery = expiredQuery.eq("job_id", jobId);
  const { data: expired } = await expiredQuery;

  const { data: { user } } = await supabase.auth.getUser();
  const purgeFailures: { id: string; storageErrors: string[] }[] = [];
  for (const row of expired ?? []) {
    const { error: auditErr } = await supabase.from("contract_events").insert({
      organization_id: row.organization_id,
      contract_id: null,
      signer_id: null,
      event_type: "invoice_purged",
      metadata: {
        invoice_id: row.id,
        invoice_number: row.invoice_number,
        actor_email: user?.email ?? null,
        purged_at: new Date().toISOString(),
        reason: "auto_30d",
      },
    });
    if (auditErr) console.warn("[api] invoice_purged audit insert failed:", auditErr.message);
    const { storageErrors } = await purgeInvoiceStorage(supabase, row.id);
    if (storageErrors.length > 0) purgeFailures.push({ id: row.id, storageErrors });
    await supabase.from("invoices").delete().eq("id", row.id);
  }

  let listQuery = supabase
    .from("invoices")
    .select("*, job:jobs!job_id(job_number, contact_id, contact:contacts(*))")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (jobId) listQuery = listQuery.eq("job_id", jobId);
  const { data: invoices, error } = await listQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    invoices: invoices ?? [],
    autoPurged: expired?.length ?? 0,
    purgeFailures,
    retentionDays: RETENTION_DAYS,
  });
}
