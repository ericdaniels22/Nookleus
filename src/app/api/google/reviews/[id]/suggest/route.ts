import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import {
  matchReviewerToContext,
  type ReviewerContactRow,
  type ReviewerJobRow,
} from "@/lib/reviews/reviewer-matcher";
import { draftReviewReply } from "@/lib/reviews/review-reply-draft";

// POST /api/google/reviews/[id]/suggest — draft an AI-suggested reply to one
// review. This endpoint NEVER posts to Google and NEVER persists: it reads the
// review, privately matches the reviewer to a Contact/Job to inform the draft,
// and returns suggested text for a human to edit and approve (#608 AC1/AC3).
async function suggestReply(
  _request: Request,
  ctx: RequestContext,
  routeContext: { params: Promise<{ id: string }> },
) {
  const service = ctx.serviceClient!;
  const orgId = ctx.orgId!; // adminOnly guarantees a resolved Active Organization
  const { id } = await routeContext.params;

  const { data: review } = await service
    .from("google_review")
    .select("id, reviewer_name, star_rating, comment")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle<{
      id: string;
      reviewer_name: string | null;
      star_rating: number;
      comment: string | null;
    }>();
  if (!review) {
    return NextResponse.json({ error: "Review not found." }, { status: 404 });
  }

  // Heuristically link the reviewer to a Contact (and their Job) to PRIVATELY
  // inform the draft. The match never surfaces in the public reply (#608 AC2);
  // draftReviewReply's system prompt enforces that.
  const { data: contacts } = await service
    .from("contacts")
    .select("id, full_name")
    .eq("organization_id", orgId);
  const { data: jobs } = await service
    .from("jobs")
    .select("id, job_number, property_address, contact_id")
    .eq("organization_id", orgId);
  const match = matchReviewerToContext(
    {
      contacts: (contacts ?? []) as ReviewerContactRow[],
      jobs: (jobs ?? []) as ReviewerJobRow[],
    },
    review.reviewer_name,
  );

  let suggested: string;
  try {
    suggested = await draftReviewReply(
      {
        star_rating: review.star_rating,
        comment: review.comment,
        reviewer_name: review.reviewer_name,
      },
      match,
    );
  } catch (err) {
    // The AI draft failed (model error, timeout, missing key). Surface it rather
    // than return a blank suggestion the human might post unread (#608 AC5).
    console.error(
      `[google-reviews] draft failed for review ${review.id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return NextResponse.json(
      { error: "Could not draft a reply right now. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ suggested_reply: suggested });
}

export const POST = withRequestContext<{ id: string }>(
  { adminOnly: true, serviceClient: true },
  suggestReply,
);
