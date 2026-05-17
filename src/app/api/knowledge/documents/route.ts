import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/knowledge/documents — list all knowledge documents.
// Previously ungated (read with the Service client, no auth check); now
// logged-in only. Recorded for the #78 ungated-endpoint list.
export const GET = withRequestContext(
  { serviceClient: true },
  async (_request, ctx) => {
    const { data, error } = await ctx.serviceClient!
      .from("knowledge_documents")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  },
);
