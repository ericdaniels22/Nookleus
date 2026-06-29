// POST /api/jobs/[id]/showcases/[showcaseId]/publish-gbp — push a Showcase to
// the Organization's connected Google Business Profile as a local post (#609,
// PRD #603, ADR 0015). Admin only, and the GBP analogue of the website publish
// route (../publish): same orchestrator shape, same consent + privacy-scrub
// gates (AC#4), but it composes the Google deep modules and stamps the gbp_*
// channel columns INDEPENDENTLY of the website channel (AC#3).

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { photoUrl } from "@/lib/jobs/photo-url";
import { getGoogleClient } from "@/lib/google/client";
import { listReviewLocations } from "@/lib/google/reviews";
import {
  scrubShowcaseForPublish,
  scrubBlockMessage,
} from "@/lib/website/showcase-scrub";
import {
  getGoogleConnection,
  deriveConnectionState,
  markBroken,
} from "@/lib/google/connection";
import {
  summarizeShowcaseForGbp,
  publishShowcaseGbpPost,
  isGbpAuthError,
} from "@/lib/google/showcase-gbp-post";
import { deriveShowcaseGbpPublishState } from "@/lib/google/showcase-gbp-state";
import type { Showcase } from "@/lib/types";

// Resolve a Showcase's LEAD photo to a public Supabase URL for the local post's
// single media item (AC#1 — "with one of its Photos"). Gallery order is
// meaningful: the first photo_id that still has a surviving Photo row wins, so a
// trashed lead photo falls through to the next rather than blocking. Returns null
// when no id resolves — the route turns that into a distinct gbp_photo_required.
async function resolveLeadPhotoUrl(
  db: SupabaseClient,
  jobId: string,
  photoIds: string[],
): Promise<string | null> {
  if (photoIds.length === 0) return null;
  const { data } = await db
    .from("photos")
    .select("id, storage_path, annotated_path")
    .eq("job_id", jobId)
    .in("id", photoIds);
  const rows = (data ?? []) as Array<{
    id: string;
    storage_path: string;
    annotated_path: string | null;
  }>;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  for (const id of photoIds) {
    const row = byId.get(id);
    if (row) return photoUrl(row, supabaseUrl, "full");
  }
  return null;
}

export const POST = withRequestContext(
  { adminOnly: true, serviceClient: true },
  async (
    request,
    ctx,
    { params }: { params: Promise<{ id: string; showcaseId: string }> },
  ) => {
    const { id: jobId, showcaseId } = await params;

    // Scope the read by job_id and the live (not-trashed) row, mirroring the
    // sibling showcase routes — a Showcase is only publishable through its own
    // Job, and a trashed draft is not publishable.
    const { data: showcase, error: showcaseError } = await ctx.supabase
      .from("showcases")
      .select("*")
      .eq("id", showcaseId)
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .maybeSingle<Showcase>();
    if (showcaseError) {
      return apiDbError(
        showcaseError.message,
        "POST /api/jobs/[id]/showcases/[showcaseId]/publish-gbp",
      );
    }
    if (!showcase) {
      return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
    }

    // Consent gate (AC#4 — the SAME rule as website publishing). Every publish to
    // the Business Profile, first or re-push, must carry an explicit one-click
    // affirmation that the customer is OK with these photos going public. Anything
    // but a literal `true` blocks; nothing reaches Google and no consent is
    // recorded.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const consent =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as { consent?: unknown }).consent
        : undefined;
    if (consent !== true) {
      return NextResponse.json(
        {
          code: "consent_required",
          message:
            "Confirm you have the customer's OK to show these photos before publishing.",
        },
        { status: 422 },
      );
    }

    // Privacy scrub (AC#4 — the SAME guard as website publishing). Pull the two
    // identifying needles for this Job — customer name and street address — with
    // FLAT reads (the test fakes don't model embedded joins), then block the
    // publish if either still appears in the title or write-up. Nothing reaches
    // Google past a block.
    const { data: job, error: jobError } = await ctx.supabase
      .from("jobs")
      .select("contact_id, property_address")
      .eq("id", jobId)
      .maybeSingle<{ contact_id: string | null; property_address: string | null }>();
    if (jobError) {
      return apiDbError(
        jobError.message,
        "POST /api/jobs/[id]/showcases/[showcaseId]/publish-gbp",
      );
    }

    let customerName = "";
    if (job?.contact_id) {
      const { data: contact, error: contactError } = await ctx.supabase
        .from("contacts")
        .select("full_name")
        .eq("id", job.contact_id)
        .maybeSingle<{ full_name: string | null }>();
      if (contactError) {
        return apiDbError(
          contactError.message,
          "POST /api/jobs/[id]/showcases/[showcaseId]/publish-gbp",
        );
      }
      customerName = contact?.full_name ?? "";
    }

    const scrub = scrubShowcaseForPublish({
      title: showcase.title,
      writeUp: showcase.write_up,
      customerName,
      propertyAddress: job?.property_address ?? "",
    });
    if (scrub.blocked) {
      return NextResponse.json(
        {
          code: "privacy_scrub_blocked",
          message: scrubBlockMessage(scrub.violations),
          violations: scrub.violations,
        },
        { status: 422 },
      );
    }

    // Connection preconditions (AC#5 leans on this distinction). The Google
    // connection lives on the service client (org-scoped), not RLS. No row → the
    // Organization never connected Google; a broken row → the grant was already
    // rejected. Each is a DISTINCT, visible state so the Marketing card can offer
    // "connect" vs "reconnect".
    const service = ctx.serviceClient!;
    const connection = await getGoogleConnection(service, ctx.orgId!);
    const connectionState = deriveConnectionState(connection);
    if (!connection || connectionState === "disconnected") {
      return NextResponse.json(
        {
          code: "not_connected",
          message:
            "Connect Google in Settings before publishing a Showcase to your Business Profile.",
        },
        { status: 409 },
      );
    }
    if (connectionState === "broken") {
      return NextResponse.json(
        {
          code: "connection_broken",
          message:
            "Your Google connection needs attention. Reconnect it in Settings, then publish again.",
        },
        { status: 409 },
      );
    }

    // Media requirement (AC#1). A Business Profile update carries exactly one
    // photo; resolve the Showcase's lead photo first so a Showcase with none is
    // rejected distinctly before any Google call.
    const photoUrlForPost = await resolveLeadPhotoUrl(
      ctx.supabase,
      jobId,
      showcase.photo_ids,
    );
    if (!photoUrlForPost) {
      return NextResponse.json(
        {
          code: "gbp_photo_required",
          message:
            "Add at least one photo to this Showcase before publishing it to your Business Profile.",
        },
        { status: 422 },
      );
    }

    // Authorize against Google with the PRIVILEGED service client (the token
    // chokepoint persists a refreshed token and may flip the row broken — both
    // admin-only writes). A null client means the refresh token was just rejected
    // and the row is already broken, so report the same reconnect-prompt state as
    // the precondition above.
    const client = await getGoogleClient(service, ctx.orgId!);
    if (!client) {
      return NextResponse.json(
        {
          code: "connection_broken",
          message:
            "Your Google connection needs attention. Reconnect it in Settings, then publish again.",
        },
        { status: 409 },
      );
    }

    // Resolve the location to post to. The connected account may manage several
    // (or, while a profile is pending verification, none); the first wins —
    // reusing the same discovery the reviews sync leans on. No location → a
    // distinct, actionable failure rather than an opaque publish error.
    const locations = await listReviewLocations(client);
    const locationName = locations[0];
    if (!locationName) {
      return NextResponse.json(
        {
          code: "gbp_no_location",
          message:
            "No Business Profile location is available on the connected Google account.",
        },
        { status: 422 },
      );
    }

    // Publish (AC#1, AC#2). Compose the plain-text summary (title + write-up,
    // truncated to the Business Profile limit) and create or update exactly one
    // local post carrying the lead photo. A recorded gbp_post_name re-pushes the
    // SAME post (update, never a duplicate); a null one creates a new post.
    const summary = summarizeShowcaseForGbp({
      title: showcase.title,
      writeUp: showcase.write_up,
    });

    // Error mapping (AC#5). A 401/403 means the connected account can no longer
    // publish to the profile — flip the connection broken (so the card prompts a
    // reconnect) and report the DISTINCT gbp_permission_denied. Every other
    // failure (5xx, network, timeout) is transient: report unreachable and leave
    // the connection untouched.
    let published;
    try {
      published = await publishShowcaseGbpPost(
        client,
        locationName,
        { summary, photoUrl: photoUrlForPost },
        showcase.gbp_post_name,
      );
    } catch (err) {
      if (isGbpAuthError(err)) {
        await markBroken(
          service,
          connection.id,
          "Business Profile publish rejected (401/403)",
        );
        return NextResponse.json(
          {
            code: "gbp_permission_denied",
            message:
              "Google rejected the publish — the connected account can't manage this Business Profile. Reconnect in Settings, then publish again.",
          },
          { status: 422 },
        );
      }
      return NextResponse.json(
        {
          code: "gbp_unreachable",
          message:
            "Couldn't reach Google Business Profile. Try again shortly — your connection is unchanged.",
        },
        { status: 502 },
      );
    }

    // Stamp the GBP channel INDEPENDENTLY (AC#3): only the gbp_* columns and the
    // consent audit (who + when). The website `status`/`published_at` are never
    // touched here, so the two channels track separately. gbp_published_at and
    // consent_confirmed_at share one timestamp — they describe the same event.
    const now = new Date().toISOString();
    const { error: stampError } = await ctx.supabase
      .from("showcases")
      .update({
        gbp_post_name: published.name,
        gbp_post_url: published.url,
        gbp_published_at: now,
        consent_confirmed_by: ctx.userId,
        consent_confirmed_at: now,
      })
      .eq("id", showcaseId)
      .eq("job_id", jobId);
    if (stampError) {
      return apiDbError(
        stampError.message,
        "POST /api/jobs/[id]/showcases/[showcaseId]/publish-gbp",
      );
    }

    return NextResponse.json(
      deriveShowcaseGbpPublishState({
        gbp_post_name: published.name,
        gbp_post_url: published.url,
        gbp_published_at: now,
      }),
    );
  },
);
