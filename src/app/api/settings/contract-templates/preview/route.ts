import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { resolveMergeFields } from "@/lib/contracts/merge-fields";

// POST /api/settings/contract-templates/preview
// Body: { jobId: string, contentHtml: string }
// Returns the merge-field-resolved HTML plus the list of fields that
// had no data on that job so the modal can flag them to the author.
//
// Requires `access_settings` (#107) — tightened from the logged-in-only #84 gate.
export const POST = withRequestContext({ permission: "access_settings" }, async (request, ctx) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.jobId !== "string" || typeof body.contentHtml !== "string") {
    return NextResponse.json(
      { error: "jobId and contentHtml are required" },
      { status: 400 },
    );
  }

  const result = await resolveMergeFields(ctx.supabase, body.contentHtml, body.jobId);
  return NextResponse.json(result);
});
