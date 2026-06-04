// Force-delete a job: enumerate every storage object the job owns, remove
// them from their respective buckets, then DELETE the job row (FK CASCADE
// takes care of related DB rows). Storage objects must be removed BEFORE
// the SQL delete, since the related rows hold the paths.
//
// Buckets touched (matches src/lib/storage/paths.ts):
//   photos       — photos.{storage_path,annotated_path}
//   job-files    — job_files.storage_path
//   reports      — photo_reports.pdf_path
//   contracts    — contracts.signed_pdf_path
//   receipts     — expenses.{receipt_path,thumbnail_path}
//
// Storage cleanup uses the service-role client because some buckets
// (job-files, contracts, receipts) are accessible only from server APIs
// using the service key. RLS-checked actions (verifying the caller can
// delete this job, the SQL delete itself) run on the cookie-aware client
// passed in by the route handler.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-api";

interface PurgeResult {
  storageRemoved: number;
  storageErrors: string[];
}

export async function purgeJobStorage(
  authedClient: SupabaseClient,
  jobId: string,
): Promise<PurgeResult> {
  const errors: string[] = [];
  let removed = 0;

  // Read paths via the user's authed client — RLS already constrains this
  // to rows in the user's org.
  const [photosRes, filesRes, reportsRes, contractsRes, expensesRes] =
    await Promise.all([
      authedClient
        .from("photos")
        .select("storage_path, annotated_path")
        .eq("job_id", jobId),
      authedClient
        .from("job_files")
        .select("storage_path")
        .eq("job_id", jobId),
      authedClient
        .from("photo_reports")
        .select("pdf_path")
        .eq("job_id", jobId),
      authedClient
        .from("contracts")
        .select("signed_pdf_path")
        .eq("job_id", jobId),
      authedClient
        .from("expenses")
        .select("receipt_path, thumbnail_path")
        .eq("job_id", jobId),
    ]);

  const photoPaths = (photosRes.data ?? []).flatMap((p) =>
    [p.storage_path, p.annotated_path].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    ),
  );
  const jobFilePaths = (filesRes.data ?? [])
    .map((f) => f.storage_path)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const reportPaths = (reportsRes.data ?? [])
    .map((r) => r.pdf_path)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const contractPaths = (contractsRes.data ?? [])
    .map((c) => c.signed_pdf_path)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const receiptPaths = (expensesRes.data ?? []).flatMap((e) =>
    [e.receipt_path, e.thumbnail_path].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    ),
  );

  const service = createServiceClient();
  const buckets: { name: string; paths: string[] }[] = [
    { name: "photos", paths: photoPaths },
    { name: "job-files", paths: jobFilePaths },
    { name: "reports", paths: reportPaths },
    { name: "contracts", paths: contractPaths },
    { name: "receipts", paths: receiptPaths },
  ];

  for (const { name, paths } of buckets) {
    if (paths.length === 0) continue;
    const { error } = await service.storage.from(name).remove(paths);
    if (error) {
      errors.push(`${name}: ${error.message}`);
    } else {
      removed += paths.length;
    }
  }

  return { storageRemoved: removed, storageErrors: errors };
}
