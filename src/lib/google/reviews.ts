// Mapping + sync for the Google Business Profile reviews inbox (#604).
//
// Reviews live only in the legacy My Business v4 API
// (mybusiness.googleapis.com/v4/{accounts/*/locations/*}/reviews). Each review
// is per-location; the inbox is Organization-scoped, so the mapper is handed
// both the Organization and the location resource name the review came from.

import type { SupabaseClient } from "@supabase/supabase-js";
import { GOOGLE_BUSINESS_ENDPOINTS } from "./config";

// The reviewer block on a v4 review. Anonymous reviewers carry no name/photo.
export interface GoogleApiReviewer {
  displayName?: string;
  profilePhotoUrl?: string;
  isAnonymous?: boolean;
}

// The owner's reply to a review, if one exists. Its presence is what makes a
// review "replied".
export interface GoogleApiReviewReply {
  comment?: string;
  updateTime?: string;
}

// A single review as returned by the v4 reviews endpoint.
export interface GoogleApiReview {
  reviewId: string;
  name?: string;
  reviewer?: GoogleApiReviewer;
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: GoogleApiReviewReply;
}

// The row we upsert into the Organization-scoped google_review table. Mirrors
// the columns one-for-one so the mapper output IS the write payload.
export interface GoogleReviewUpsert {
  organization_id: string;
  google_review_id: string;
  location_name: string;
  reviewer_name: string | null;
  reviewer_photo_url: string | null;
  star_rating: number;
  comment: string | null;
  review_created_at: string | null;
  review_updated_at: string | null;
  replied: boolean;
  reply_comment: string | null;
  reply_updated_at: string | null;
}

// Google returns the rating as a word enum (ONE..FIVE). Map it to 1..5;
// anything unspecified or unrecognised becomes 0.
const STAR_WORDS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export function starRatingToInt(rating: string | undefined): number {
  if (!rating) return 0;
  return STAR_WORDS[rating] ?? 0;
}

export function mapReviewToRow(input: {
  organizationId: string;
  locationName: string;
  review: GoogleApiReview;
}): GoogleReviewUpsert {
  const { organizationId, locationName, review } = input;
  const reply = review.reviewReply;

  return {
    organization_id: organizationId,
    google_review_id: review.reviewId,
    location_name: locationName,
    reviewer_name: review.reviewer?.displayName ?? null,
    reviewer_photo_url: review.reviewer?.profilePhotoUrl ?? null,
    star_rating: starRatingToInt(review.starRating),
    comment: review.comment ?? null,
    review_created_at: review.createTime ?? null,
    review_updated_at: review.updateTime ?? null,
    replied: Boolean(reply),
    reply_comment: reply?.comment ?? null,
    reply_updated_at: reply?.updateTime ?? null,
  };
}

// The fetch layer only needs an authorized `.fetch` (the bearer token is
// injected by GoogleClient). Narrowing to this interface keeps the helpers
// testable with a tiny fake and decoupled from token plumbing.
export interface ReviewsApiClient {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

interface ReviewsPage {
  reviews?: GoogleApiReview[];
  nextPageToken?: string;
}

interface AccountsPage {
  accounts?: { name: string }[];
  nextPageToken?: string;
}

interface LocationsPage {
  locations?: { name: string }[];
  nextPageToken?: string;
}

const PAGE_SIZE = 50;

// All reviews for one location, draining every page. The location is a full
// v4 resource name ("accounts/*/locations/*").
export async function fetchLocationReviews(
  client: ReviewsApiClient,
  locationName: string,
): Promise<GoogleApiReview[]> {
  const all: GoogleApiReview[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `${GOOGLE_BUSINESS_ENDPOINTS.reviewsBase}/${locationName}/reviews`,
    );
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await client.fetch(url.toString());
    if (!res.ok) {
      throw new Error(
        `Google reviews fetch failed (${res.status}) for ${locationName}`,
      );
    }
    const page = (await res.json()) as ReviewsPage;
    if (page.reviews) all.push(...page.reviews);
    pageToken = page.nextPageToken;
  } while (pageToken);

  return all;
}

// Post (or overwrite) the owner's reply to one review — the v4 updateReply
// call: PUT {reviewsBase}/{location}/reviews/{reviewId}/reply with a
// { comment } body. The location is a full v4 resource name
// ("accounts/*/locations/*"). Bearer token is injected by the GoogleClient.
export async function postReviewReply(
  client: ReviewsApiClient,
  locationName: string,
  googleReviewId: string,
  comment: string,
): Promise<{ updateTime: string | null }> {
  const url = `${GOOGLE_BUSINESS_ENDPOINTS.reviewsBase}/${locationName}/reviews/${googleReviewId}/reply`;
  const res = await client.fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comment }),
  });
  if (!res.ok) {
    throw new Error(
      `Google review reply failed (${res.status}) for ${locationName}/reviews/${googleReviewId}`,
    );
  }
  const reply = (await res.json()) as GoogleApiReviewReply;
  return { updateTime: reply.updateTime ?? null };
}

// Flip one local review row to replied after a reply posts to Google: record
// the comment that went out and the reply's updateTime. Org-scoped (id alone is
// the PK, but the explicit organization_id filter keeps the write correct under
// a service client too — google_review is admin-only RLS, so callers pass a
// PRIVILEGED db). The (replied=true, reply_comment, reply_updated_at) triple
// satisfies the google_review_reply_consistency CHECK constraint.
export async function markReviewReplied(
  db: SupabaseClient,
  organizationId: string,
  reviewRowId: string,
  comment: string,
  updateTime: string | null,
): Promise<void> {
  const { error } = await db
    .from("google_review")
    .update({
      replied: true,
      reply_comment: comment,
      reply_updated_at: updateTime,
    })
    .eq("id", reviewRowId)
    .eq("organization_id", organizationId);
  if (error) {
    throw new Error(`google_review reply update failed: ${error.message}`);
  }
}

async function listAccounts(client: ReviewsApiClient): Promise<string[]> {
  const names: string[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(GOOGLE_BUSINESS_ENDPOINTS.accounts);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await client.fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Google accounts fetch failed (${res.status})`);
    }
    const page = (await res.json()) as AccountsPage;
    for (const account of page.accounts ?? []) names.push(account.name);
    pageToken = page.nextPageToken;
  } while (pageToken);

  return names;
}

async function listAccountLocations(
  client: ReviewsApiClient,
  accountName: string,
): Promise<string[]> {
  const names: string[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `${GOOGLE_BUSINESS_ENDPOINTS.businessInformationBase}/${accountName}/locations`,
    );
    // readMask is required by the Business Information API; we only need name.
    url.searchParams.set("readMask", "name");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await client.fetch(url.toString());
    if (!res.ok) {
      throw new Error(
        `Google locations fetch failed (${res.status}) for ${accountName}`,
      );
    }
    const page = (await res.json()) as LocationsPage;
    // location.name is "locations/*"; the v4 reviews API needs the full
    // "accounts/*/locations/*" resource name.
    for (const loc of page.locations ?? []) names.push(`${accountName}/${loc.name}`);
    pageToken = page.nextPageToken;
  } while (pageToken);

  return names;
}

// Every location whose reviews this connection can read, as full v4 resource
// names. Discovered by walking accounts → locations across the split modern
// Business Profile APIs.
export async function listReviewLocations(
  client: ReviewsApiClient,
): Promise<string[]> {
  const accounts = await listAccounts(client);
  const locations: string[] = [];
  for (const account of accounts) {
    locations.push(...(await listAccountLocations(client, account)));
  }
  return locations;
}

// Idempotent batch write: upsert on (organization_id, google_review_id) so a
// re-sync of the same review updates its row in place instead of duplicating —
// and carries forward any reply-state change captured by mapReviewToRow. Pass a
// PRIVILEGED db: google_review is admin-only RLS, so a non-admin client would
// silently write zero rows. Empty batch is a no-op (no wasted round-trip).
export async function upsertReviews(
  db: SupabaseClient,
  rows: GoogleReviewUpsert[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db
    .from("google_review")
    .upsert(rows, { onConflict: "organization_id,google_review_id" });
  if (error) {
    throw new Error(`google_review upsert failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Read layer — the Marketing inbox.
// ---------------------------------------------------------------------------

// One row as the Marketing Reviews inbox renders it. A projection of
// google_review (no token/internal columns) — `replied` is the flag the inbox
// surfaces so unreplied reviews stand out.
export interface GoogleReviewInboxItem {
  id: string;
  google_review_id: string;
  location_name: string;
  reviewer_name: string | null;
  reviewer_photo_url: string | null;
  star_rating: number;
  comment: string | null;
  review_created_at: string | null;
  replied: boolean;
  reply_comment: string | null;
  reply_updated_at: string | null;
}

const REVIEW_INBOX_COLUMNS =
  "id, google_review_id, location_name, reviewer_name, reviewer_photo_url, " +
  "star_rating, comment, review_created_at, replied, reply_comment, reply_updated_at";

// Inbox order: unreplied first (they need action), newest first within each
// group, and a review with no createTime sorts to the end of its group. Sorted
// in code rather than via .order() so the order is one deterministic rule the
// tests pin directly — the QB scheduled-sync processor sorts client-side for the
// same reason. The inbox is bounded (one org's reviews), so no pagination.
function sortInboxItems(items: GoogleReviewInboxItem[]): GoogleReviewInboxItem[] {
  return [...items].sort((a, b) => {
    if (a.replied !== b.replied) return a.replied ? 1 : -1; // unreplied first
    const at = a.review_created_at;
    const bt = b.review_created_at;
    if (at === bt) return 0;
    if (at === null) return 1; // nulls last
    if (bt === null) return -1;
    return at < bt ? 1 : -1; // newest first
  });
}

// The Organization's reviews for the Marketing inbox, ordered for display.
// Org-scoped (RLS also enforces this; the explicit filter keeps the query
// correct under a service client too).
export async function listOrganizationReviews(
  db: SupabaseClient,
  organizationId: string,
): Promise<GoogleReviewInboxItem[]> {
  const { data, error } = await db
    .from("google_review")
    .select(REVIEW_INBOX_COLUMNS)
    .eq("organization_id", organizationId);
  if (error) {
    throw new Error(`google_review list failed: ${error.message}`);
  }
  return sortInboxItems((data ?? []) as unknown as GoogleReviewInboxItem[]);
}

export interface ReviewSyncResult {
  locations: number;
  reviewsSynced: number;
}

// The scheduled-sync orchestrator (the cron job and the manual-sync route call
// this): discover the Organization's locations, pull every review per location,
// map them to rows, and upsert idempotently. `client` is an authorized
// GoogleClient; `db` must be privileged (see upsertReviews).
export async function syncOrganizationReviews(input: {
  db: SupabaseClient;
  organizationId: string;
  client: ReviewsApiClient;
}): Promise<ReviewSyncResult> {
  const { db, organizationId, client } = input;
  const locations = await listReviewLocations(client);

  let reviewsSynced = 0;
  for (const locationName of locations) {
    const reviews = await fetchLocationReviews(client, locationName);
    const rows = reviews.map((review) =>
      mapReviewToRow({ organizationId, locationName, review }),
    );
    await upsertReviews(db, rows);
    reviewsSynced += rows.length;
  }

  return { locations: locations.length, reviewsSynced };
}

// The tally a scheduled run reports. `organizations` is how many were
// considered; `synced` + `skipped` + `failed` partition them.
export interface ReviewSyncRunResult {
  organizations: number;
  synced: number;
  skipped: number;
  failed: number;
  reviewsSynced: number;
}

// The multi-tenant scheduled-sync entry point (the cron calls this). Fans out
// over every connected Organization, syncing each in isolation: an org whose
// connection yields no client (broken / disconnected) is SKIPPED, and an org
// that throws mid-sync is counted FAILED but never aborts the run — one broken
// connection must not starve every other Organization's inbox. `getClient` is
// injected (the route wires it to getGoogleClient over a privileged db) so the
// fan-out stays testable without token plumbing.
export async function syncAllConnectedReviews(input: {
  db: SupabaseClient;
  organizationIds: string[];
  getClient: (organizationId: string) => Promise<ReviewsApiClient | null>;
}): Promise<ReviewSyncRunResult> {
  const { db, organizationIds, getClient } = input;
  let synced = 0;
  let skipped = 0;
  let failed = 0;
  let reviewsSynced = 0;

  for (const organizationId of organizationIds) {
    try {
      const client = await getClient(organizationId);
      if (!client) {
        skipped += 1;
        continue;
      }
      const result = await syncOrganizationReviews({ db, organizationId, client });
      synced += 1;
      reviewsSynced += result.reviewsSynced;
    } catch (err) {
      failed += 1;
      console.error(
        `[google-reviews] sync failed for org ${organizationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return {
    organizations: organizationIds.length,
    synced,
    skipped,
    failed,
    reviewsSynced,
  };
}
