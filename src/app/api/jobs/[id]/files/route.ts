import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/jobs/[id]/files — list files for a job (scoped to active org).
// Previously ungated (RLS-only); now requires `view_jobs` (#103).
export const GET = withRequestContext(
  { permission: "view_jobs" },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: jobId } = await params;

    const { data, error } = await ctx.supabase
      .from("job_files")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  },
);

// POST /api/jobs/[id]/files — REGISTER files already uploaded direct-to-storage
// via a signed URL (build30/job-files). The bytes never stream through this
// handler anymore, so a multi-megabyte photo report no longer trips Vercel's
// 4.5 MB request-body limit. Body is small JSON metadata:
//   { files: [{ filename, storagePath, size, mimeType }] }
//
// Each storagePath MUST sit under the caller's `${orgId}/${jobId}/` folder.
// The signed-URL token already constrains where bytes could land, but we
// re-check here so a forged registration can't point a row at another org's
// object. Returns { succeeded: JobFile[], failed: { filename, error }[] } with
// 200 (all ok) / 207 (partial) / 500 (all failed). Requires `edit_jobs` (#103).
export const POST = withRequestContext(
  { permission: "edit_jobs" },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: jobId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const entries = (body as { files?: unknown } | null)?.files;
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const supabase = ctx.supabase;
    const orgId = ctx.orgId;
    const prefix = `${orgId}/${jobId}/`;
    const succeeded: unknown[] = [];
    const failed: { filename: string; error: string }[] = [];

    for (const entry of entries as {
      filename?: unknown;
      storagePath?: unknown;
      size?: unknown;
      mimeType?: unknown;
    }[]) {
      const filename =
        typeof entry?.filename === "string" ? entry.filename : "";
      const storagePath =
        typeof entry?.storagePath === "string" ? entry.storagePath : "";

      if (!filename || !storagePath) {
        failed.push({
          filename: filename || "(unknown)",
          error: "Missing filename or storagePath",
        });
        continue;
      }

      if (!storagePath.startsWith(prefix)) {
        failed.push({
          filename,
          error: "Upload path is outside this job's folder",
        });
        continue;
      }

      const { data: row, error: insertError } = await supabase
        .from("job_files")
        .insert({
          organization_id: orgId,
          job_id: jobId,
          filename,
          storage_path: storagePath,
          size_bytes: typeof entry.size === "number" ? entry.size : 0,
          mime_type:
            typeof entry.mimeType === "string" && entry.mimeType
              ? entry.mimeType
              : "application/octet-stream",
        })
        .select()
        .single();

      if (insertError) {
        // Best-effort: drop the orphaned object the row would have referenced.
        await supabase.storage.from("job-files").remove([storagePath]);
        failed.push({ filename, error: insertError.message });
        continue;
      }

      succeeded.push(row);
    }

    // 200 = all good, 207 = partial, 500 = all failed
    const status =
      failed.length === 0 ? 200 : succeeded.length === 0 ? 500 : 207;

    return NextResponse.json({ succeeded, failed }, { status });
  },
);
