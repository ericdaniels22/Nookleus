import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { randomUUID } from "crypto";

// POST /api/jobs/[id]/files/upload-url — mint a signed upload URL per file so
// the browser uploads bytes STRAIGHT to Supabase Storage, bypassing the 4.5 MB
// serverless request-body limit that rejected large photo-report uploads with
// a plain-text 413 (build30/job-files). The returned token authorizes exactly
// the `${orgId}/${jobId}/<uuid>-<filename>` path it was minted for, so the
// upload can't escape this job's folder. Gated on `edit_jobs`, same as the
// register endpoint that follows it.
//
// Body:    { files: [{ filename, contentType?, size? }] }
// Returns: { uploads: [{ filename, storagePath, token, signedUrl }] }  (aligned)
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

    const files = (body as { files?: unknown } | null)?.files;
    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const uploads: {
      filename: string;
      storagePath: string;
      token: string;
      signedUrl: string;
    }[] = [];

    for (const entry of files as { filename?: unknown }[]) {
      const filename =
        typeof entry?.filename === "string" ? entry.filename : null;
      if (!filename) {
        return NextResponse.json(
          { error: "Each file needs a filename" },
          { status: 400 },
        );
      }

      const storagePath = `${ctx.orgId}/${jobId}/${randomUUID()}-${filename}`;
      const { data, error } = await ctx.supabase.storage
        .from("job-files")
        .createSignedUploadUrl(storagePath);

      if (error || !data) {
        return NextResponse.json(
          { error: error?.message ?? "Could not create upload URL" },
          { status: 500 },
        );
      }

      uploads.push({
        filename,
        storagePath,
        token: data.token,
        signedUrl: data.signedUrl,
      });
    }

    return NextResponse.json({ uploads });
  },
);
