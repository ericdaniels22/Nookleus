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

// Every transient Google failure (a 5xx/network/timeout during the token
// refresh, the location discovery, or the publish itself) reports the SAME
// distinct, retryable outcome and — crucially — leaves the connection untouched
// (AC#5). One helper so all three call sites stay in lockstep.
function gbpUnreachable() {
  return NextResponse.json(
    {
      code: "gbp_unreachable",
      message:
        "Couldn't reach Google Business Profile. Try again shortly — your connection is unchanged.",
    },
    { status: 502 },
  );
}

// Google Business Profile local posts accept ONLY JPG/PNG media. A job photo,
// though, can be a WebP/HEIC original (the uploader takes image/*) or even a
// video — and the "full" photoUrl hot-links the raw original with its extension
// intact. So the lead's format must be checked here, before the URL ever reaches
// Google; otherwise the format reject surfaces as a misleading transient
// gbp_unreachable the user can never clear by retrying (AC#2).
const GBP_SUPPORTED_PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);

function isGbpSupportedPhoto(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return GBP_SUPPORTED_PHOTO_EXTENSIONS.has(ext);
}

// The outcome of resolving a Showcase's lead photo: a usable URL, or a DISTINCT
// reason the route maps to its own actionable failure code. "missing" → no
// resolvable photo at all (gbp_photo_required); "unsupported" → the lead exists
// but isn't a format the Business Profile accepts (gbp_photo_unsupported).
type LeadPhotoResolution =
  | { kind: "ok"; url: string }
  | { kind: "missing" }
  | { kind: "unsupported" };

// Resolve a Showcase's LEAD photo to a public Supabase URL for the local post's
// single media item (AC#1 — "with one of its Photos"). Gallery order is
// meaningful: the first photo_id that still has a surviving Photo row IS the lead,
// so a trashed lead photo falls through to the next rather than blocking. Once the
// lead is found its format is enforced (AC#2) — a WebP/HEIC/video lead is reported
// distinctly rather than hot-linked to a sure-to-fail Google call.
async function resolveLeadPhotoUrl(
  db: SupabaseClient,
  jobId: string,
  photoIds: string[],
): Promise<LeadPhotoResolution> {
  if (photoIds.length === 0) return { kind: "missing" };
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
    if (!row) continue; // trashed — fall through to the next surviving photo
    // The first surviving photo IS the lead. photoUrl("full") hot-links the raw
    // original at `annotated_path || storage_path`, so guard that exact path.
    if (!isGbpSupportedPhoto(row.annotated_path ?? row.storage_path)) {
      return { kind: "unsupported" };
    }
    return { kind: "ok", url: photoUrl(row, supabaseUrl, "full") };
  }
  return { kind: "missing" };
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

    // Media requirement (AC#1, AC#2). A Business Profile update carries exactly one
    // photo, and only a JPG/PNG one. Resolve the Showcase's lead photo first so
    // both shortfalls are rejected DISTINCTLY before any Google call: no resolvable
    // photo → gbp_photo_required; a WebP/HEIC/video lead → gbp_photo_unsupported.
    const lead = await resolveLeadPhotoUrl(
      ctx.supabase,
      jobId,
      showcase.photo_ids,
    );
    if (lead.kind === "missing") {
      return NextResponse.json(
        {
          code: "gbp_photo_required",
          message:
            "Add at least one photo to this Showcase before publishing it to your Business Profile.",
        },
        { status: 422 },
      );
    }
    if (lead.kind === "unsupported") {
      return NextResponse.json(
        {
          code: "gbp_photo_unsupported",
          message:
            "This Showcase's lead photo isn't a format Google Business Profile accepts. Make a JPG or PNG photo the first one, then publish again.",
        },
        { status: 422 },
      );
    }
    const photoUrlForPost = lead.url;

    // Authorize against Google with the PRIVILEGED service client (the token
    // chokepoint persists a refreshed token and may flip the row broken — both
    // admin-only writes). A null client means the refresh token was just rejected
    // (invalid_grant) and the row is already broken, so report the same
    // reconnect-prompt state as the precondition above. A THROW is different: a
    // transient 5xx/network blip at the token endpoint during the refresh — the
    // grant isn't revoked, so surface the DISTINCT gbp_unreachable (AC#5) rather
    // than letting it escape as an opaque 500, and leave the connection untouched.
    let client;
    try {
      client = await getGoogleClient(service, ctx.orgId!);
    } catch {
      return gbpUnreachable();
    }
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
    //
    // listReviewLocations walks accounts→locations over the network and throws a
    // plain Error on any non-ok response (a 5xx/429/network blip, or a discovery
    // 401/403). Catch it like the publish call's transient branch: surface the
    // DISTINCT gbp_unreachable (AC#5) instead of letting the throw escape as an
    // opaque 500. We do NOT flip the connection broken here — the throw carries no
    // typed status to safely tell a grant failure from a quota/rate-limit one, and
    // this connection is shared with reviews (#604) + insights (#607); only the
    // publish call below, which throws a typed GbpPublishError, breaks it.
    let locations: string[];
    try {
      locations = await listReviewLocations(client);
    } catch {
      return gbpUnreachable();
    }
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
      return gbpUnreachable();
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
