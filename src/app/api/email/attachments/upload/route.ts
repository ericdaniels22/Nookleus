import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { sanitizeStorageFilename } from "@/lib/storage/paths";

// POST /api/email/attachments/upload — upload a file for composing.
// Returns { id, filename, content_type, file_size, storage_path }.
// Requires `send_email` (#105, PRD #95) — tightened from the logged-in-only
// gate the #85 Request-Context conversion gave this previously-ungated route.
export const POST = withRequestContext({ permission: "send_email" }, async (request, ctx) => {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const timestamp = Date.now();
  // file.name can carry em dashes / smart punctuation Supabase rejects as an
  // "Invalid key" — sanitize the segment. The original name is still returned
  // below as `filename` for display and the download Content-Disposition.
  const storagePath = `drafts/${timestamp}-${sanitizeStorageFilename(file.name)}`;

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
