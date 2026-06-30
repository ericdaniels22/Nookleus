// #609 — publishing a Showcase to the Organization's Google Business Profile.
//
// A Showcase is pushed to the connected Business Profile as a LOCAL POST (the
// "updates" that appear on the profile), mirroring the WordPress publisher in
// src/lib/website/wordpress.ts but for the Google channel. Two pure-ish pieces:
//
//   • summarizeShowcaseForGbp — shapes the title + write-up into the plain-text
//     `summary` a local post carries, within the Business Profile length limit
//     (#609 AC#2). Local posts are plain text, not HTML, so this is the GBP
//     analogue of renderShowcaseBodyHtml.
//   • publishShowcaseGbpPost — the v4 REST create/update for one local post.

import { GOOGLE_BUSINESS_ENDPOINTS } from "./config";

// Google Business Profile caps a local post's `summary` at 1500 characters
// (AC#2). The composed title + write-up is truncated to fit, ellipsis included,
// so the post never exceeds the constraint.
export const GBP_SUMMARY_MAX_LENGTH = 1500;
const ELLIPSIS = "…";

// What the publisher needs from a Showcase to build the post summary.
export interface ShowcaseGbpContent {
  title: string;
  writeUp: string;
}

// Cut `text` to at most `max` characters, ending on a word boundary and marking
// the elision with a trailing ellipsis. The ellipsis counts toward `max`, so the
// result is always ≤ max. Falls back to a hard cut when there is no whitespace to
// break on (a single very long token).
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const budget = max - ELLIPSIS.length;
  const slice = text.slice(0, budget);
  const lastSpace = slice.lastIndexOf(" ");
  const kept = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

// Compose the title and write-up into the local post's plain-text summary,
// truncated to the Business Profile length limit.
export function summarizeShowcaseForGbp(input: ShowcaseGbpContent): string {
  const parts = [input.title.trim(), input.writeUp.trim()].filter(Boolean);
  return truncateAtWord(parts.join("\n\n"), GBP_SUMMARY_MAX_LENGTH);
}

// ---------------------------------------------------------------------------
// The v4 local-posts REST client.
//
// The fetch layer only needs an authorized `.fetch` (the bearer token is
// injected by GoogleClient). Narrowing to this interface keeps the publisher
// testable with a tiny fake and decoupled from token plumbing — same shape as
// reviews.ts's ReviewsApiClient.
// ---------------------------------------------------------------------------
export interface GbpPostApiClient {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

// The one Showcase-derived photo the local post carries. A Business Profile
// update shows a single image (AC#1 — "with one of its Photos"), hot-linked by
// its public URL, never re-uploaded.
export interface ShowcaseGbpPost {
  summary: string;
  photoUrl: string;
}

// What a publish records back on the Showcase: the remote LocalPost resource
// name (reused on re-publish to update the SAME post) and its live searchUrl.
export interface PublishedGbpPost {
  name: string;
  url: string;
}

// A failed local-posts REST call. `status` carries the HTTP status so the route
// can tell a permission failure (401/403 — the connected account can't manage
// this profile) from a transient one (5xx/network), and `code` carries Google's
// own error status (e.g. "PERMISSION_DENIED") for logging. Mirrors WordPressError
// in src/lib/website/wordpress.ts — the GBP analogue of that publisher's error.
export class GbpPublishError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GbpPublishError";
    this.status = status;
    this.code = code;
  }
}

// Turn a non-ok response into a GbpPublishError. Google REST errors carry an
// { error: { status, message } } envelope; fall back to http_<status> for a
// non-JSON body (e.g. a 5xx HTML page from a proxy) so a transient failure stays
// distinguishable from a permission denial.
async function toGbpPublishError(res: Response): Promise<GbpPublishError> {
  let code = `http_${res.status}`;
  let message = `Google Business Profile endpoint returned ${res.status}`;
  try {
    const body = (await res.json()) as {
      error?: { status?: unknown; message?: unknown };
    };
    if (typeof body.error?.status === "string") code = body.error.status;
    if (typeof body.error?.message === "string") message = body.error.message;
  } catch {
    // non-JSON body — keep the http_<status> code.
  }
  return new GbpPublishError(res.status, code, message);
}

// The one signal the route branches on: was this failure the connected account
// being unable to publish to the profile? Only then does the route flip the
// connection broken and prompt a reconnect. The GBP analogue of wordpress.ts's
// isRevokedError, but it must gate on Google's error CODE, not just the HTTP
// status — and 403 is overloaded:
//
//   • 401 — the token was rejected outright. Always a connection problem.
//   • 403 with code PERMISSION_DENIED — the grant is scoped to an account that
//     can't manage this Business Profile. A real reconnect-worthy failure (unlike
//     a WordPress Application Password, a Google grant can be so scoped).
//   • 403 with any OTHER code (RESOURCE_EXHAUSTED, a disabled-API / zero-quota
//     project condition) — NOT the user's grant. Reconnecting can't clear it, and
//     this connection is SHARED with reviews (#604) and insights (#607), so
//     breaking it would silently disable them and loop the user through
//     reconnect→403→broken. Treat as transient instead.
//
// Every other failure (5xx, 429, network) is transient — never break on it.
export function isGbpAuthError(err: unknown): boolean {
  if (!(err instanceof GbpPublishError)) return false;
  if (err.status === 401) return true;
  if (err.status === 403) return err.code === "PERMISSION_DENIED";
  return false;
}

// Local posts are authored in the connection's locale; en-US is the app's only
// supported language today.
const LOCAL_POST_LANGUAGE = "en-US";

// Build the LocalPost request body: a STANDARD update with the summary and a
// single PHOTO media item.
function localPostBody(post: ShowcaseGbpPost) {
  return {
    languageCode: LOCAL_POST_LANGUAGE,
    summary: post.summary,
    topicType: "STANDARD",
    media: [{ mediaFormat: "PHOTO", sourceUrl: post.photoUrl }],
  };
}

// Create OR update exactly one local post and report its name + live URL. A
// recorded `existingPostName` re-pushes the SAME post (PATCH), so editing a
// published Showcase updates the existing update instead of stacking a duplicate
// onto the profile — the GBP analogue of publishShowcasePost's create-vs-update.
export async function publishShowcaseGbpPost(
  client: GbpPostApiClient,
  locationName: string,
  post: ShowcaseGbpPost,
  existingPostName: string | null,
): Promise<PublishedGbpPost> {
  const base = GOOGLE_BUSINESS_ENDPOINTS.localPostsBase;
  // existingPostName set → PATCH the SAME LocalPost (update the summary + photo);
  // null → POST a new one to the collection. This is the single point that makes
  // an edit an update, never a second update on the profile.
  const [url, method] = existingPostName
    ? [`${base}/${existingPostName}?updateMask=summary,media`, "PATCH"]
    : [`${base}/${locationName}/localPosts`, "POST"];

  const res = await client.fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(localPostBody(post)),
  });

  // A non-ok response never counts as a published post: throw a typed error the
  // route classifies as a permission denial (markBroken) or a transient failure.
  if (!res.ok) throw await toGbpPublishError(res);

  const created = (await res.json()) as { name?: unknown; searchUrl?: unknown };
  // `name` is the LocalPost resource id we record as gbp_post_name — the SOLE
  // signal the channel keys 'published' on and re-pushes the SAME post by. A 2xx
  // without it is a contract violation; coercing it to "" would stamp an empty
  // name (reported as draft, re-POSTed as a duplicate). Fail loudly instead — the
  // GBP analogue of wordpress.ts throwing when a create returns no id.
  if (typeof created.name !== "string" || created.name.length === 0) {
    throw new Error(
      "Google Business Profile returned no post name for the published local post",
    );
  }
  return {
    name: created.name,
    url: typeof created.searchUrl === "string" ? created.searchUrl : "",
  };
}
