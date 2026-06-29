import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

// #608 — AI-drafted suggested replies. An unreplied row offers a "Draft reply"
// button that fetches a suggestion the admin edits before posting. Nothing ever
// auto-posts: the draft lands in an editable field and posting is a second,
// explicit step (AC1/AC3).
describe("<ReviewsInbox> — AI-drafted reply flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchJson(byUrl: Record<string, unknown>) {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => byUrl[url] ?? {},
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("drafts a suggested reply into an editable field when Draft reply is clicked", async () => {
    const fetchMock = stubFetchJson({
      "/api/google/reviews/rev-9/suggest": {
        suggested_reply: "Thank you so much for the kind words!",
      },
    });
    render(<ReviewsInbox reviews={[makeReview({ id: "rev-9", replied: false })]} />);

    fireEvent.click(screen.getByTestId("draft-reply"));

    const editor = (await screen.findByTestId(
      "reply-editor",
    )) as HTMLTextAreaElement;
    expect(editor.value).toBe("Thank you so much for the kind words!");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/google/reviews/rev-9/suggest",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("posts the edited draft and flips the card to replied", async () => {
    const fetchMock = stubFetchJson({
      "/api/google/reviews/rev-9/suggest": { suggested_reply: "Thanks!" },
      "/api/google/reviews/rev-9/reply": {
        id: "rev-9",
        replied: true,
        reply_comment: "Thanks a lot, Pat!",
        reply_updated_at: "2026-06-29T00:00:00Z",
      },
    });
    render(<ReviewsInbox reviews={[makeReview({ id: "rev-9", replied: false })]} />);

    fireEvent.click(screen.getByTestId("draft-reply"));
    const editor = (await screen.findByTestId(
      "reply-editor",
    )) as HTMLTextAreaElement;

    // The admin edits the draft before posting — there is no auto-post path
    // (AC3): the text that posts is whatever the human approved.
    fireEvent.change(editor, { target: { value: "Thanks a lot, Pat!" } });
    fireEvent.click(screen.getByTestId("post-reply"));

    // On success the card flips to replied and shows the posted reply (AC4).
    expect(await screen.findByTestId("review-replied")).toBeTruthy();
    expect(screen.queryByTestId("review-needs-reply")).toBeNull();
    expect(screen.getByText("Thanks a lot, Pat!")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/google/reviews/rev-9/reply",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ comment: "Thanks a lot, Pat!" }),
      }),
    );
  });

  it("surfaces a failed post and leaves the card unreplied for retry", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/suggest")) {
        return { ok: true, json: async () => ({ suggested_reply: "Thanks!" }) };
      }
      // The post to Google fails — the route returns an error with a non-2xx.
      return {
        ok: false,
        json: async () => ({
          error: "Could not post the reply to Google. Please try again.",
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReviewsInbox reviews={[makeReview({ id: "rev-9", replied: false })]} />);

    fireEvent.click(screen.getByTestId("draft-reply"));
    await screen.findByTestId("reply-editor");
    fireEvent.click(screen.getByTestId("post-reply"));

    // The failure is shown, not swallowed; the card stays unreplied with the
    // editor intact so the admin can fix and retry (AC5).
    const error = await screen.findByTestId("reply-error");
    expect(error.textContent).toContain("Could not post the reply to Google.");
    expect(screen.getByTestId("review-needs-reply")).toBeTruthy();
    expect(screen.queryByTestId("review-replied")).toBeNull();
    expect(screen.getByTestId("reply-editor")).toBeTruthy();
  });

  it("surfaces a failed draft instead of opening an empty editor", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({
        error: "Could not draft a reply right now. Please try again.",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReviewsInbox reviews={[makeReview({ id: "rev-9", replied: false })]} />);

    fireEvent.click(screen.getByTestId("draft-reply"));

    // A drafting failure is surfaced rather than swallowed into a blank editor
    // the admin might post unread (#608 AC5 in spirit).
    const error = await screen.findByTestId("reply-error");
    expect(error.textContent).toContain("Could not draft a reply right now.");
    expect(screen.queryByTestId("reply-editor")).toBeNull();
    expect(screen.getByTestId("review-needs-reply")).toBeTruthy();
  });

  it("surfaces a thrown fetch (offline / non-JSON) instead of failing silently", async () => {
    // A rejected fetch (network down) or a non-JSON error body would otherwise
    // throw an unhandled rejection with nothing shown — the button appears dead.
    // Surface it (#608 AC5).
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReviewsInbox reviews={[makeReview({ id: "rev-9", replied: false })]} />);

    fireEvent.click(screen.getByTestId("draft-reply"));

    const error = await screen.findByTestId("reply-error");
    expect(error.textContent).toBeTruthy();
    expect(screen.queryByTestId("reply-editor")).toBeNull();
    expect(screen.getByTestId("review-needs-reply")).toBeTruthy();
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
