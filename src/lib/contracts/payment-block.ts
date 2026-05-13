import type { SupabaseClient } from "@supabase/supabase-js";

// Thrown by assertJobHasNoPayments when at least one invoice on the job
// has a recorded payment. Routes catch this and translate to HTTP 409
// with the canonical message about refunding or voiding payments first.
export class JobHasPaymentsError extends Error {
  constructor(jobId: string) {
    super(
      `Cannot complete this action — related invoices for job ${jobId} have recorded payments. Refund or void payments first.`,
    );
    this.name = "JobHasPaymentsError";
  }
}

// Shared payment-block check used by both the void route and the
// permanent-delete route. Lifted out of the inlined check in the void
// route so the rule cannot drift between the two call sites.
export async function assertJobHasNoPayments(
  supabase: SupabaseClient,
  jobId: string,
): Promise<void> {
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id")
    .eq("job_id", jobId);

  const invoiceIds = (invoices ?? []).map(
    (r: { id: string }) => r.id,
  );
  if (invoiceIds.length === 0) return;

  const { count } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true })
    .in("invoice_id", invoiceIds);

  if ((count ?? 0) > 0) {
    throw new JobHasPaymentsError(jobId);
  }
}
