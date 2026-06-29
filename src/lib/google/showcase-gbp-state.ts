import type { Showcase } from "@/lib/types";

// #609 (AC#3) — the pure read of a Showcase's GOOGLE BUSINESS PROFILE publish
// state, the GBP analogue of website/showcase-publish-state.ts. The two channels
// are independent: this deriver reads ONLY the gbp_* columns and never the
// website-coupled `status`, so a Showcase can be live on the Business Profile
// while still a website draft (and vice versa). The route response and the
// publish panel's GBP row both ask this one function "is there a live Business
// Profile post, and where".

export type ShowcaseGbpPublishState = "draft" | "published";

export interface ShowcaseGbpPublishView {
  state: ShowcaseGbpPublishState;
  liveUrl: string | null;
  publishedAt: string | null;
}

type ShowcaseGbpFields = Pick<
  Showcase,
  "gbp_post_name" | "gbp_post_url" | "gbp_published_at"
>;

export function deriveShowcaseGbpPublishState(
  showcase: ShowcaseGbpFields,
): ShowcaseGbpPublishView {
  // Published iff there is a recorded LocalPost — the GBP channel's own evidence,
  // not the website `status`. A live link exists only while that post does, so a
  // stale url left behind never surfaces on a Showcase with no current post.
  const published = Boolean(showcase.gbp_post_name);
  return {
    state: published ? "published" : "draft",
    liveUrl: published ? showcase.gbp_post_url : null,
    publishedAt: published ? showcase.gbp_published_at : null,
  };
}
