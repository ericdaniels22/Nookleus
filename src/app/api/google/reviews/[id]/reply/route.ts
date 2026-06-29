import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { getGoogleClient } from "@/lib/google/client";
import { postReviewReply, markReviewReplied } from "@/lib/google/reviews";

// POST /api/google/reviews/[id]/reply — post an admin-approved reply to one
// review on Google, then flip the local row to replied. The reply text is
// supplied by the human in the request body: there is NO auto-post path — an
// empty/blank comment is rejected before anything reaches Google (#608 AC3).
async function postReply(
  request: Request,
  ctx: RequestContext,
  routeContext: { params: Promise<{ id: string }> },
) {
  const body = (await request.json().catch(() => null)) as {
    comment?: unknown;
  } | null;
  const comment = typeof body?.comment === "string" ? body.comment.trim() : "";
  if (!comment) {
    return NextResponse.json(
      { error: "A reply comment is required." },
      { status: 400 },
    );
  }

  const service = ctx.serviceClient!;
  const orgId = ctx.orgId!; // adminOnly guarantees a resolved Active Organization
  const { id } = await routeContext.params;

  // Load the review row, org-scoped, to learn which location + Google review id
  // the reply targets. A miss (wrong org, or no such review) is a 404 — and
  // crucially nothing has been posted to Google yet.
  const { data: review } = await service
    .from("google_review")
    .select("id, location_name, google_review_id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle<{
      id: string;
      location_name: string;
      google_review_id: string;
    }>();
  if (!review) {
    return NextResponse.json({ error: "Review not found." }, { status: 404 });
  }

  const client = await getGoogleClient(service, orgId);
  if (!client) {
    // No usable connection (disconnected or token broken). Surface it — the
    // reply is not posted and local state stays unreplied (#608 AC5).
    return NextResponse.json(
      { error: "Google account is not connected." },
      { status: 502 },
    );
  }

  let updateTime: string | null;
  try {
    ({ updateTime } = await postReviewReply(
      client,
      review.location_name,
      review.google_review_id,
      comment,
    ));
    await markReviewReplied(service, orgId, review.id, comment, updateTime);
  } catch (err) {
    // The reply did not post (or the local flip failed). Surface it rather than
    // swallow it; local state is unchanged unless the flip itself succeeded
    // (postReviewReply runs first, so a post failure leaves the row unreplied)
    // (#608 AC5).
    console.error(
      `[google-reviews] reply post failed for review ${review.id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return NextResponse.json(
      { error: "Could not post the reply to Google. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    id: review.id,
    replied: true,
    reply_comment: comment,
    reply_updated_at: updateTime,
  });
}

export const POST = withRequestContext<{ id: string }>(
  { adminOnly: true, serviceClient: true },
  postReply,
);
