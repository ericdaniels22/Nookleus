import { describe, it, expect } from "vitest";
import { deriveShowcasePublishState } from "./showcase-publish-state";

// #606 — the pure read of a Showcase's publish state, used by the route response
// and the builder UI (the badge + the "View live post" link). Centralises the
// "when is there a live link" rule so the component stays dumb.

describe("deriveShowcasePublishState", () => {
  it("reports a draft Showcase as draft with no live link", () => {
    const view = deriveShowcasePublishState({
      status: "draft",
      wordpress_post_url: null,
      published_at: null,
    });

    expect(view).toEqual({ state: "draft", liveUrl: null, publishedAt: null });
  });

  it("reports a published Showcase with its live URL and publish time", () => {
    const view = deriveShowcasePublishState({
      status: "published",
      wordpress_post_url: "https://example.com/projects/storm-roof",
      published_at: "2026-06-29T12:00:00.000Z",
    });

    expect(view).toEqual({
      state: "published",
      liveUrl: "https://example.com/projects/storm-roof",
      publishedAt: "2026-06-29T12:00:00.000Z",
    });
  });

  it("never offers a live link for a draft, even if a stale URL lingers", () => {
    const view = deriveShowcasePublishState({
      status: "draft",
      wordpress_post_url: "https://example.com/projects/old",
      published_at: null,
    });

    expect(view.liveUrl).toBeNull();
  });
});
