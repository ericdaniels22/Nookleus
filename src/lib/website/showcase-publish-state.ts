import type { Showcase } from "@/lib/types";

// #606 — the pure read of a Showcase's publish state. The route response and the
// builder UI (the Draft/Published badge + the "View live post" link) both ask
// this one function "is there a live post, and where". Centralising the rule
// keeps the component dumb: a live link exists only while the Showcase is
// actually published, so a stale wordpress_post_url left behind on a draft never
// surfaces.

export type ShowcasePublishState = "draft" | "published";

export interface ShowcasePublishView {
  state: ShowcasePublishState;
  liveUrl: string | null;
  publishedAt: string | null;
}

type ShowcasePublishFields = Pick<
  Showcase,
  "status" | "wordpress_post_url" | "published_at"
>;

export function deriveShowcasePublishState(
  showcase: ShowcasePublishFields,
): ShowcasePublishView {
  const published = showcase.status === "published";
  return {
    state: published ? "published" : "draft",
    liveUrl: published ? showcase.wordpress_post_url : null,
    publishedAt: published ? showcase.published_at : null,
  };
}
