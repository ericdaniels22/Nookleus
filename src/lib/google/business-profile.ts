// issue #605 (parent PRD #603, ADR 0015) — Google Business Profile review target.
//
// The deep module that turns an Organization's Google connection into the one
// thing "Request review" needs: a direct Google review link plus the business
// name to put in the message. Callers ask getOrganizationReviewTarget(db, orgId)
// and receive { reviewLink, businessName } or null — they never touch the
// Business Profile API, account/location listing, or token handling (that is
// getGoogleClient's job).
//
// PASS A PRIVILEGED `db` — the same rule getGoogleClient documents: this rides
// the admin-only google_connection through the deep module, so hand in the
// Service client (or an admin's client). See src/lib/google/client.ts.
//
// v1 handles a single Business Profile location: it reads the first account and
// that account's first location. An Organization with multiple Google locations
// is out of scope for this slice (PRD #603) — the first location wins.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleClient, type GoogleClient } from "./client";
import { buildReviewLink } from "@/lib/reviews/review-request";

// Google Business Profile API hosts. Account listing and location/metadata
// reads live on two different sub-APIs.
const ACCOUNTS_URL =
  "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const BUSINESS_INFO_BASE =
  "https://mybusinessbusinessinformation.googleapis.com/v1";
// The Business Information API requires an explicit field mask; metadata is
// where newReviewUri and placeId live.
const LOCATION_READ_MASK = "name,title,metadata";

interface GbpAccount {
  name?: string; // "accounts/{id}"
}
interface GbpLocationMetadata {
  newReviewUri?: string;
  placeId?: string;
}
interface GbpLocation {
  name?: string; // "locations/{id}"
  title?: string;
  metadata?: GbpLocationMetadata;
}

export interface ReviewTarget {
  // The direct Google "leave a review" link for the connected location.
  reviewLink: string;
  // The business name to use in the request copy.
  businessName: string;
}

export interface ReviewTargetDeps {
  // Injectable for tests; defaults to the real authorized client.
  client?: GoogleClient | null;
}

async function getJson<T>(client: GoogleClient, url: string): Promise<T> {
  const res = await client.fetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Google Business Profile request failed (${res.status}) for ${url}: ${detail.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

async function lookupOrgName(
  db: SupabaseClient,
  organizationId: string,
): Promise<string | null> {
  const { data } = await db
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle<{ name: string | null }>();
  return data?.name?.trim() || null;
}

/**
 * Resolves the review target for an Organization: its direct Google review link
 * and the business name for the message.
 *
 * Returns null when the request cannot be made into a review — no Google
 * connection (or a broken one), no Business Profile account/location, or a
 * location that carries neither a review URI nor a Place ID. The route turns a
 * null into an actionable "connect Google / no review link" message rather than
 * a failure. Genuine HTTP errors from Google throw, so a transient outage
 * surfaces as a 5xx instead of masquerading as "not connected".
 */
export async function getOrganizationReviewTarget(
  db: SupabaseClient,
  organizationId: string,
  deps: ReviewTargetDeps = {},
): Promise<ReviewTarget | null> {
  const client =
    deps.client !== undefined
      ? deps.client
      : await getGoogleClient(db, organizationId);
  if (!client) return null;

  const accountsBody = await getJson<{ accounts?: GbpAccount[] }>(
    client,
    ACCOUNTS_URL,
  );
  const account = accountsBody.accounts?.[0];
  if (!account?.name) return null;

  const locationsUrl = `${BUSINESS_INFO_BASE}/${account.name}/locations?readMask=${encodeURIComponent(
    LOCATION_READ_MASK,
  )}`;
  const locationsBody = await getJson<{ locations?: GbpLocation[] }>(
    client,
    locationsUrl,
  );
  const location = locationsBody.locations?.[0];
  if (!location) return null;

  const reviewLink = buildReviewLink({
    newReviewUri: location.metadata?.newReviewUri,
    placeId: location.metadata?.placeId,
  });
  if (!reviewLink) return null;

  const businessName =
    location.title?.trim() ||
    (await lookupOrgName(db, organizationId)) ||
    "our team";

  return { reviewLink, businessName };
}
