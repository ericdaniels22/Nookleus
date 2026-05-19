import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/knowledge/documents/[id] — get a single document with chunk count.
// Previously ungated (read with the Service client, no auth check); now
// logged-in only. Recorded for the #78 ungated-endpoint list.
export const GET = withRequestContext(
  { serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const { data, error } = await ctx.serviceClient!
      .from("knowledge_documents")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  },
);

// DELETE /api/knowledge/documents/[id] — delete document, chunks (CASCADE), and storage file.
// Admin-only (#121): the knowledge base is product-level global content with
// no organization_id, so a delete is a destructive cross-org action — it must
// not be reachable by an ordinary member of any org. `adminOnly` needs no new
// permission key; managing shared product content is an admin concern.
export const DELETE = withRequestContext(
  { adminOnly: true, serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const supabase = ctx.serviceClient!;

      // 1. Get the document to find its storage path
      const { data: doc, error: fetchError } = await supabase
        .from("knowledge_documents")
        .select("id, file_path")
        .eq("id", id)
        .single();

      if (fetchError || !doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }

      // 2. Delete from storage bucket
      if (doc.file_path) {
        await supabase.storage.from("knowledge-docs").remove([doc.file_path]);
      }

      // 3. Delete the document row (chunks cascade automatically)
      const { error: deleteError } = await supabase
        .from("knowledge_documents")
        .delete()
        .eq("id", id);

      if (deleteError) {
        return NextResponse.json(
          { error: `Delete failed: ${deleteError.message}` },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true });
    } catch (err) {
      console.error("Knowledge document delete error:", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  },
);
