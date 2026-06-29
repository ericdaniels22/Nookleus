"use client";

import { useState, useEffect, useCallback } from "react";
import { Star } from "lucide-react";
import type { GoogleReviewInboxItem } from "@/lib/google/reviews";

// Five stars, the filled ones matching the rating. The numeric rating is
// surfaced as an accessible label so screen readers (and tests) don't depend on
// the glyphs.
function StarRating({ value }: { value: number }) {
  return (
    <div
      className="flex items-center gap-0.5 mt-0.5"
      aria-label={`${value} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={14}
          className={
            i <= value
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/40"
          }
        />
      ))}
    </div>
  );
}

function ReviewRow({ review }: { review: GoogleReviewInboxItem }) {
  return (
    <li className="rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {review.reviewer_name ?? "Anonymous"}
          </p>
          <StarRating value={review.star_rating} />
        </div>
        {review.replied ? (
          <span
            data-testid="review-replied"
            className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
          >
            Replied
          </span>
        ) : (
          <span
            data-testid="review-needs-reply"
            className="shrink-0 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-300"
          >
            Needs reply
          </span>
        )}
      </div>

      {review.comment && (
        <p className="mt-2 text-sm text-foreground/90 whitespace-pre-wrap">
          {review.comment}
        </p>
      )}

      {review.replied && review.reply_comment && (
        <div className="mt-3 rounded-lg bg-muted/50 p-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Your reply
          </p>
          <p className="text-sm text-foreground/90 whitespace-pre-wrap">
            {review.reply_comment}
          </p>
        </div>
      )}
    </li>
  );
}

// Pure presentational inbox: one row per review. Order is decided upstream
// (listOrganizationReviews sorts unreplied first), so this just renders. The
// per-row "Needs reply" badge is the flag the acceptance criterion calls for.
export function ReviewsInbox({
  reviews,
}: {
  reviews: GoogleReviewInboxItem[];
}) {
  if (reviews.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-border rounded-xl">
        <p className="text-sm text-muted-foreground mb-1">No reviews yet</p>
        <p className="text-xs text-muted-foreground/60">
          Connected Google reviews will appear here after the next sync.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {reviews.map((review) => (
        <ReviewRow key={review.id} review={review} />
      ))}
    </ul>
  );
}

// The Marketing → Reviews tab. Reads this Organization's Google reviews from the
// admin-only read route and renders them, unreplied first (the route sorts).
export default function MarketingReviewsTab() {
  const [reviews, setReviews] = useState<GoogleReviewInboxItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/google/reviews");
      const data = await res.json();
      setReviews(data.reviews ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Reviews</h2>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Loading reviews...
        </p>
      ) : (
        <ReviewsInbox reviews={reviews} />
      )}
    </div>
  );
}
