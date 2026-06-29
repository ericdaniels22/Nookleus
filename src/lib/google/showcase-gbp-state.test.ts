// #609 (AC#3) — the GBP channel's publish state is read INDEPENDENTLY of the
// website channel. These tests pin that independence in both directions: a
// Showcase pushed to the Business Profile reads published even while the website
// is still a draft, and a website-published Showcase reads GBP-draft until it has
// its own recorded local post.

import { describe, it, expect } from "vitest";

import { deriveShowcaseGbpPublishState } from "./showcase-gbp-state";

describe("deriveShowcaseGbpPublishState", () => {
  it("reports a recorded Business Profile post as published, independent of the website channel (AC#3)", () => {
    const view = deriveShowcaseGbpPublishState({
      gbp_post_name: "accounts/1/locations/2/localPosts/9",
      gbp_post_url: "https://www.google.com/search?q=gbp-post",
      gbp_published_at: "2026-06-29T00:00:00.000Z",
    });

    expect(view).toEqual({
      state: "published",
      liveUrl: "https://www.google.com/search?q=gbp-post",
      publishedAt: "2026-06-29T00:00:00.000Z",
    });
  });

  it("reports a Showcase with no recorded post as a GBP draft and hides any stale url (AC#3)", () => {
    // No gbp_post_name → the Business Profile channel is a draft, even if the
    // website channel is already live. A url/timestamp lingering from a prior
    // post never leaks as a live link once there is no current post.
    const view = deriveShowcaseGbpPublishState({
      gbp_post_name: null,
      gbp_post_url: "https://stale.example/old",
      gbp_published_at: "2026-01-01T00:00:00.000Z",
    });

    expect(view).toEqual({ state: "draft", liveUrl: null, publishedAt: null });
  });
});
