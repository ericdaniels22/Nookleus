import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// PATCH /api/jobs/[id]/files/[fileId] — rename
// Previously ungated (RLS-only); now logged-in only via `withRequestContext`.
export const PATCH = withRequestContext(
  {},
  async (
    request,
    ctx,
    { params }: { params: Promise<{ id: string; fileId: string }> },
  ) => {
    const { fileId } = await params;

    const body = await request.json().catch(() => null);
    const rawFilename = typeof body?.filename === "string" ? body.filename : "";
    const filename = rawFilename.trim();

    if (!filename) {
      return NextResponse.json({ error: "Filename is required" }, { status: 400 });
    }
    if (filename.length > 255) {
      return NextResponse.json(
        { error: "Filename must be 255 characters or fewer" },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from("job_files")
      .update({ filename })
      .eq("id", fileId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  },
);

// DELETE /api/jobs/[id]/files/[fileId] — delete storage object, then row
export const DELETE = withRequestContext(
  {},
  async (
    _request,
    ctx,
    { params }: { params: Promise<{ id: string; fileId: string }> },
  ) => {
    const { fileId } = await params;
    const supabase = ctx.supabase;

    // 1. Look up storage_path
    const { data: row, error: lookupError } = await supabase
      .from("job_files")
      .select("storage_path")
      .eq("id", fileId)
      .single();

    if (lookupError || !row) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // 2. Delete storage object first
    const { error: storageError } = await supabase.storage
      .from("job-files")
      .remove([row.storage_path]);

    if (storageError) {
      return NextResponse.json(
        { error: `Storage delete failed: ${storageError.message}` },
        { status: 500 }
      );
    }

    // 3. Delete row (if this fails, the object is already gone — acceptable;
    //    the next list fetch will still show the row and user can retry)
    const { error: deleteError } = await supabase
      .from("job_files")
      .delete()
      .eq("id", fileId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  },
);
