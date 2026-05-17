import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// POST /api/email/attachments/upload — upload a file for composing.
// Returns { id, filename, content_type, file_size, storage_path }.
// Previously ungated (relied on RLS via the User client); now logged-in
// only. Recorded for the #78 ungated-endpoint list.
export const POST = withRequestContext({}, async (request, ctx) => {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const timestamp = Date.now();
  const storagePath = `drafts/${timestamp}-${file.name}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await ctx.supabase.storage
    .from("email-attachments")
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  return NextResponse.json({
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    file_size: file.size,
    storage_path: storagePath,
  });
});
