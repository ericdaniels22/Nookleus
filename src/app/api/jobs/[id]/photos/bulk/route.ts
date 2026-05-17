import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// DELETE /api/jobs/[id]/photos/bulk — bulk-delete photos.
// Previously ungated (RLS-only); now logged-in only via `withRequestContext`.
export const DELETE = withRequestContext(
  {},
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: jobId } = await params;
    const { photoIds } = await request.json() as { photoIds: string[] };

    if (!photoIds || photoIds.length === 0) {
      return NextResponse.json({ error: "No photo IDs provided" }, { status: 400 });
    }

    const supabase = ctx.supabase;

    const { data: photos, error: fetchError } = await supabase
      .from("photos")
      .select("id, storage_path, annotated_path, thumbnail_path")
      .eq("job_id", jobId)
      .in("id", photoIds);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!photos || photos.length === 0) {
      return NextResponse.json({ error: "No matching photos found" }, { status: 404 });
    }

    const storagePaths: string[] = [];
    for (const photo of photos) {
      storagePaths.push(photo.storage_path);
      if (photo.annotated_path) storagePaths.push(photo.annotated_path);
      if (photo.thumbnail_path) storagePaths.push(photo.thumbnail_path);
      const ext = photo.storage_path.split(".").pop();
      const basePath = photo.storage_path.replace(`.${ext}`, "");
      storagePaths.push(`${basePath}-original.${ext}`);
    }

    await supabase.storage.from("photos").remove(storagePaths);

    const { error: deleteError } = await supabase
      .from("photos")
      .delete()
      .eq("job_id", jobId)
      .in("id", photoIds);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: photos.length });
  },
);
