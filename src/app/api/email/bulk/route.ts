import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// PATCH /api/email/bulk — bulk update emails
// Body: { ids: string[], action: "mark_read" | "mark_unread" | "archive" | "trash" | "assign_job", jobId?: string }
// Requires `send_email` (#105, PRD #95) — tightened from the logged-in-only
// gate the #85 Request-Context conversion gave this previously-ungated route.
export const PATCH = withRequestContext({ permission: "send_email" }, async (request, ctx) => {
  const body = await request.json();
  const { ids, action, jobId } = body;

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id: unknown) => typeof id === "string")) {
    return NextResponse.json({ error: "ids must be a non-empty array of strings" }, { status: 400 });
  }

  if (ids.length > 500) {
    return NextResponse.json({ error: "Maximum 500 ids per request" }, { status: 400 });
  }

  if (!action || typeof action !== "string") {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  let updates: Record<string, unknown> = {};

  switch (action) {
    case "mark_read":
      updates = { is_read: true };
      break;
    case "mark_unread":
      updates = { is_read: false };
      break;
    case "archive":
      updates = { folder: "archive" };
      break;
    case "trash":
      updates = { folder: "trash" };
      break;
    case "spam":
      updates = { folder: "spam" };
      break;
    case "assign_job":
      if (!jobId) {
        return NextResponse.json({ error: "jobId required for assign_job" }, { status: 400 });
      }
      // Job-linked mail lives in the Jobs bucket (#954).
      updates = { job_id: jobId, matched_by: "manual", category: "jobs" };
      break;
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  const { error, count } = await ctx.supabase
    .from("emails")
    .update(updates)
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ updated: count ?? ids.length });
});
