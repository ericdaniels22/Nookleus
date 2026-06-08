import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";

// POST /api/jobs/[id]/photos/[photoId]/duplicate — Duplicate (clean same-Job
// copy, #519). Copies the clean ORIGINAL blob to a fresh path, then hands that
// path to the `duplicate_photo` deep module, which writes the new Photo row and
// re-links its tags. The annotation render is never copied — a duplicate is a
// clean original. Gated on `edit_jobs`; the Job scope (+ RLS) confirms the
// caller owns the Photo.
export const POST = withRequestContext(
  { permission: "edit_jobs" },
  async (
    _request,
    ctx,
    { params }: { params: Promise<{ id: string; photoId: string }> },
  ) => {
    const { id: jobId, photoId } = await params;
    const supabase = ctx.supabase;

    const { data: source, error: fetchErr } = await supabase
      .from("photos")
      .select("storage_path")
      .eq("job_id", jobId)
      .eq("id", photoId)
      .maybeSingle();
    if (fetchErr) return apiDbError(fetchErr.message, "POST duplicate select");
    if (!source) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    // Copy the clean original to a fresh org/job-scoped path so the duplicate
    // owns an independent object — deleting or annotating one never touches the
    // other. The extension follows the original.
    const ext = source.storage_path.split(".").pop() || "jpg";
    const newPath = `${ctx.orgId}/${jobId}/${randomUUID()}.${ext}`;
    const { error: copyErr } = await supabase.storage
      .from("photos")
      .copy(source.storage_path, newPath);
    if (copyErr) return apiDbError(copyErr.message, "POST duplicate copy");

    // The deep module writes the new row + re-links tags, returning the copy.
    const { data: duplicated, error: rpcErr } = await supabase.rpc(
      "duplicate_photo",
      { p_source_photo_id: photoId, p_new_storage_path: newPath },
    );
    if (rpcErr) return apiDbError(rpcErr.message, "POST duplicate insert");

    return NextResponse.json(duplicated, { status: 201 });
  },
);
