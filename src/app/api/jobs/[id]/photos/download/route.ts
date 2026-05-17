import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// POST /api/jobs/[id]/photos/download — signed URLs for selected photos.
// Previously ungated (RLS-only); now logged-in only via `withRequestContext`.
export const POST = withRequestContext(
  {},
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: jobId } = await params;
    const { photoIds } = await request.json() as { photoIds: string[] };

    if (!photoIds || photoIds.length === 0) {
      return NextResponse.json({ error: "No photo IDs provided" }, { status: 400 });
    }

    const supabase = ctx.supabase;

    const { data: photos, error } = await supabase
      .from("photos")
      .select("id, storage_path, caption")
      .eq("job_id", jobId)
      .in("id", photoIds);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!photos?.length) return NextResponse.json({ error: "No matching photos" }, { status: 404 });

    const urls = await Promise.all(
      photos.map(async (photo) => {
        const { data } = await supabase.storage
          .from("photos")
          .createSignedUrl(photo.storage_path, 3600);
        return {
          id: photo.id,
          url: data?.signedUrl || null,
          filename: photo.storage_path.split("/").pop() || "photo.jpg",
          caption: photo.caption,
        };
      })
    );

    return NextResponse.json({ urls: urls.filter((u) => u.url !== null) });
  },
);
