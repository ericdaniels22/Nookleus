import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/email/attachments/[id] — download an attachment.
// Previously ungated (relied on RLS via the User client); now logged-in
// only. Recorded for the #78 ungated-endpoint list.
export const GET = withRequestContext(
  {},
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    // Get attachment metadata
    const { data: attachment, error } = await ctx.supabase
      .from("email_attachments")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !attachment || !attachment.storage_path) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    // Download from storage
    const { data: fileData, error: dlError } = await ctx.supabase.storage
      .from("email-attachments")
      .download(attachment.storage_path);

    if (dlError || !fileData) {
      return NextResponse.json({ error: "File not found in storage" }, { status: 404 });
    }

    const arrayBuffer = await fileData.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": attachment.content_type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
        "Content-Length": String(arrayBuffer.byteLength),
      },
    });
  },
);
