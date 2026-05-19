import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// POST /api/jobs/[id]/photos/bulk-tag — add/remove tags on selected photos.
// Previously ungated (RLS-only); now requires `edit_jobs` (#103).
export const POST = withRequestContext(
  { permission: "edit_jobs" },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: jobId } = await params;
    const { photoIds, tagIds, action } = await request.json() as {
      photoIds: string[];
      tagIds: string[];
      action: "add" | "remove";
    };

    if (!photoIds?.length || !tagIds?.length || !action) {
      return NextResponse.json({ error: "Missing photoIds, tagIds, or action" }, { status: 400 });
    }

    const supabase = ctx.supabase;

    const { data: photos } = await supabase
      .from("photos")
      .select("id")
      .eq("job_id", jobId)
      .in("id", photoIds);

    const validIds = (photos || []).map((p) => p.id);

    if (action === "add") {
      const rows = validIds.flatMap((photoId) =>
        tagIds.map((tagId) => ({ photo_id: photoId, tag_id: tagId }))
      );
      const { error } = await supabase
        .from("photo_tag_assignments")
        .upsert(rows, { onConflict: "photo_id,tag_id", ignoreDuplicates: true });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await supabase
        .from("photo_tag_assignments")
        .delete()
        .in("photo_id", validIds)
        .in("tag_id", tagIds);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ updated: validIds.length });
  },
);
