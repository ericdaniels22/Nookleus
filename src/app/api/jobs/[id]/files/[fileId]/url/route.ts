import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/jobs/[id]/files/[fileId]/url — short-lived signed URL
// Returns { url: string, expiresAt: string }
// The URL is "inline" (no forced Content-Disposition: attachment) so the
// same URL works for both iframe preview (PDFs) and direct download via
// an <a download> link on the client. Do NOT pass the `download` option
// to createSignedUrl — that forces Content-Disposition: attachment and
// breaks iframe preview.
// Previously ungated (RLS-only); now requires `view_jobs` (#103).
export const GET = withRequestContext(
  { permission: "view_jobs" },
  async (
    _request,
    ctx,
    { params }: { params: Promise<{ id: string; fileId: string }> },
  ) => {
    const { fileId } = await params;
    const supabase = ctx.supabase;

    const { data: row, error: lookupError } = await supabase
      .from("job_files")
      .select("storage_path")
      .eq("id", fileId)
      .single();

    if (lookupError || !row) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const { data, error } = await supabase.storage
      .from("job-files")
      .createSignedUrl(row.storage_path, 600);

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Failed to create signed URL" },
        { status: 500 }
      );
    }

    const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();
    return NextResponse.json({ url: data.signedUrl, expiresAt });
  },
);
