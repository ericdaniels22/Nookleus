import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GoogleReviewInboxItem } from "@/lib/google/reviews";
import MarketingReviewsTab, { ReviewsInbox } from "./MarketingReviewsTab";

function makeReview(
  over: Partial<GoogleReviewInboxItem> = {},
): GoogleReviewInboxItem {
  return {
    id: "rev-1",
    google_review_id: "g-1",
    location_name: "accounts/1/locations/1",
    reviewer_name: "Pat Reviewer",
    reviewer_photo_url: null,
    star_rating: 5,
    comment: "Great crew, fast work.",
    review_created_at: "2026-06-10T00:00:00Z",
    replied: false,
    reply_comment: null,
    reply_updated_at: null,
    ...over,
  };
}

// #604 — the Marketing Reviews inbox. The acceptance criterion that matters
// here: reviews are listed with unreplied ones clearly flagged.
describe("<ReviewsInbox>", () => {
  it("renders the empty-state copy when there are no reviews", () => {
    render(<ReviewsInbox reviews={[]} />);
    expect(screen.getByText("No reviews yet")).toBeTruthy();
  });

  it("renders the reviewer name and comment for each review", () => {
    render(
      <ReviewsInbox
        reviews={[
          makeReview({ id: "a", reviewer_name: "Alice", comment: "Loved it." }),
          makeReview({ id: "b", reviewer_name: "Bob", comment: "On time." }),
        ]}
      />,
    );
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Loved it.")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("On time.")).toBeTruthy();
  });

  it("falls back to Anonymous when the reviewer has no name", () => {
    render(<ReviewsInbox reviews={[makeReview({ reviewer_name: null })]} />);
    expect(screen.getByText("Anonymous")).toBeTruthy();
  });

  it("flags an unreplied review as needing a reply and not as replied", () => {
    render(<ReviewsInbox reviews={[makeReview({ replied: false })]} />);
    expect(screen.getByTestId("review-needs-reply")).toBeTruthy();
    expect(screen.queryByTestId("review-replied")).toBeNull();
  });

  it("marks a replied review as replied and shows the owner reply, not the needs-reply flag", () => {
    render(
      <ReviewsInbox
        reviews={[
          makeReview({
            replied: true,
            reply_comment: "Thanks so much, Pat!",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("review-replied")).toBeTruthy();
    expect(screen.queryByTestId("review-needs-reply")).toBeNull();
    expect(screen.getByText("Thanks so much, Pat!")).toBeTruthy();
  });

  it("exposes the star rating as an accessible label", () => {
    render(<ReviewsInbox reviews={[makeReview({ star_rating: 4 })]} />);
    expect(screen.getByLabelText("4 out of 5 stars")).toBeTruthy();
  });
});

describe("<MarketingReviewsTab>", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches /api/google/reviews and renders the inbox with unreplied flagged", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        reviews: [
          makeReview({ id: "u", reviewer_name: "Unhappy", replied: false }),
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MarketingReviewsTab />);

    expect(await screen.findByText("Unhappy")).toBeTruthy();
    expect(screen.getByTestId("review-needs-reply")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/google/reviews");
  });
});
