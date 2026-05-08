// Hard-purge cleanup for a single estimate or invoice: removes the canonical
// PDF (and any preset variants stored at the same path) from the `pdfs` bucket
// before the parent SQL delete cascades. Mirrors src/lib/jobs/purge.ts.
//
// Returns a result object the route can fold into its response — Storage
// errors do not block the row delete (build66 precedent: orphan storage is
// recoverable, half-deleted rows are not).

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-api";
import { estimatePdfPath, invoicePdfPath } from "@/lib/storage/paths";

export interface PurgeResult {
  storageRemoved: number;
  storageErrors: string[];
}

export async function purgeEstimateStorage(
  authedClient: SupabaseClient,
  estimateId: string,
): Promise<PurgeResult> {
  const { data: est } = await authedClient
    .from("estimates")
    .select("organization_id, job_id, estimate_number")
    .eq("id", estimateId)
    .maybeSingle<{
      organization_id: string;
      job_id: string;
      estimate_number: string;
    }>();
  if (!est) return { storageRemoved: 0, storageErrors: [] };

  const { data: job } = await authedClient
    .from("jobs")
    .select("job_number")
    .eq("id", est.job_id)
    .maybeSingle<{ job_number: string }>();
  if (!job?.job_number) return { storageRemoved: 0, storageErrors: ["job_number not found"] };

  const path = estimatePdfPath(est.organization_id, job.job_number, est.estimate_number);
  return removeFromPdfsBucket([path]);
}

export async function purgeInvoiceStorage(
  authedClient: SupabaseClient,
  invoiceId: string,
): Promise<PurgeResult> {
  const { data: inv } = await authedClient
    .from("invoices")
    .select("organization_id, job_id, invoice_number")
    .eq("id", invoiceId)
    .maybeSingle<{
      organization_id: string;
      job_id: string;
      invoice_number: string;
    }>();
  if (!inv) return { storageRemoved: 0, storageErrors: [] };

  const { data: job } = await authedClient
    .from("jobs")
    .select("job_number")
    .eq("id", inv.job_id)
    .maybeSingle<{ job_number: string }>();
  if (!job?.job_number) return { storageRemoved: 0, storageErrors: ["job_number not found"] };

  const path = invoicePdfPath(inv.organization_id, job.job_number, inv.invoice_number);
  return removeFromPdfsBucket([path]);
}

async function removeFromPdfsBucket(paths: string[]): Promise<PurgeResult> {
  if (paths.length === 0) return { storageRemoved: 0, storageErrors: [] };
  const service = createServiceClient();
  const { error } = await service.storage.from("pdfs").remove(paths);
  if (error) return { storageRemoved: 0, storageErrors: [error.message] };
  return { storageRemoved: paths.length, storageErrors: [] };
}
