import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { embedQuery } from "@/lib/knowledge/embeddings";

// POST /api/knowledge/search — semantic search over knowledge chunks.
// Logged-in only — matches the route's prior cookie-auth check.
export const POST = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    try {
      const body = await request.json();
      const { query, document_id, standard_id, limit = 5 } = body;

      if (!query || typeof query !== "string") {
        return NextResponse.json({ error: "query is required" }, { status: 400 });
      }

      // 1. Embed the query via Voyage AI
      const queryEmbedding = await embedQuery(query);

      const supabase = ctx.serviceClient!;

      // 2. Run vector similarity search via the database function
      const { data, error } = await supabase.rpc("search_knowledge_chunks", {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: Math.min(limit, 20),
        filter_document_id: document_id || null,
      });

      if (error) {
        console.error("Search error:", error);
        return NextResponse.json(
          { error: `Search failed: ${error.message}` },
          { status: 500 }
        );
      }

      let results = data || [];

      // Optional: filter by standard_id (requires joining with knowledge_documents)
      if (standard_id && results.length > 0) {
        const docIds = [...new Set(results.map((r: { document_id: string }) => r.document_id))];
        const { data: docs } = await supabase
          .from("knowledge_documents")
          .select("id, standard_id")
          .in("id", docIds)
          .eq("standard_id", standard_id);

        if (docs) {
          const matchingDocIds = new Set(docs.map((d) => d.id));
          results = results.filter((r: { document_id: string }) => matchingDocIds.has(r.document_id));
        }
      }

      return NextResponse.json({ results });
    } catch (err) {
      console.error("Knowledge search error:", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  },
);
