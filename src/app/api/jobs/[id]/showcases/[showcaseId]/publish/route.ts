// POST /api/jobs/[id]/showcases/[showcaseId]/publish — push a Showcase live to
// the Organization's connected WordPress site (#606, PRD #603, ADR 0015). Admin
// only. The route is the orchestrator; the domain work lives in deep modules it
// composes:
//
//   • scrubShowcaseForPublish — the publish-time privacy guard (AC#2)
//   • renderShowcaseBodyHtml  — the post body from write-up + photo URLs
//   • publishShowcasePost     — the WordPress REST create/update (AC#3, #5)
//   • getWebsiteConnection / markBroken — the connection store
//
// Every publish re-affirms consent and re-runs the scrub against the current
// content, so an edit is gated exactly like a first publish.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { decrypt } from "@/lib/encryption";
import { photoUrl } from "@/lib/jobs/photo-url";
import {
  scrubShowcaseForPublish,
  scrubBlockMessage,
} from "@/lib/website/showcase-scrub";
import {
  getWebsiteConnection,
  deriveConnectionState,
  markBroken,
} from "@/lib/website/connection";
import { renderShowcaseBodyHtml } from "@/lib/website/showcase-post";
import { publishShowcasePost, isRevokedError } from "@/lib/website/wordpress";
import { deriveShowcasePublishState } from "@/lib/website/showcase-publish-state";
import type { Showcase } from "@/lib/types";

// Resolve a Showcase's ordered photo ids to public Supabase URLs for hot-linking
// into the post body. The gallery order is meaningful, so the rows (which come
// back in arbitrary order) are re-sequenced to match photo_ids exactly; an id
// with no surviving Photo row simply drops out.
async function resolveShowcasePhotoUrls(
  db: SupabaseClient,
  jobId: string,
  photoIds: string[],
): Promise<string[]> {
  if (photoIds.length === 0) return [];
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
  return photoIds
    .map((id) => byId.get(id))
    .filter((row): row is (typeof rows)[number] => row != null)
    .map((row) => photoUrl(row, supabaseUrl, "full"));
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
        "POST /api/jobs/[id]/showcases/[showcaseId]/publish",
      );
    }
    if (!showcase) {
      return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
    }

    // Consent gate (AC#1). Every publish — first or re-push — must carry an
    // explicit one-click affirmation that the customer is OK with these photos
    // going public. Anything but a literal `true` blocks the publish; nothing is
    // pushed and no consent is recorded.
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

    // Privacy scrub (AC#2). Pull the two identifying needles for this Job —
    // customer name and street address — with FLAT reads (the test fakes don't
    // model embedded joins), then block the publish if either still appears in
    // the title or write-up. No WordPress call happens past a block.
    const { data: job, error: jobError } = await ctx.supabase
      .from("jobs")
      .select("contact_id, property_address")
      .eq("id", jobId)
      .maybeSingle<{ contact_id: string | null; property_address: string | null }>();
    if (jobError) {
      return apiDbError(
        jobError.message,
        "POST /api/jobs/[id]/showcases/[showcaseId]/publish",
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
          "POST /api/jobs/[id]/showcases/[showcaseId]/publish",
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

    // Connection preconditions (AC#5 leans on this distinction). The connection
    // lives on the service client (org-scoped), not RLS. No row → never set up;
    // a broken row → the credential was already rejected. Each is a DISTINCT,
    // visible state so the UI can offer "connect" vs "reconnect".
    const service = ctx.serviceClient!;
    const connection = await getWebsiteConnection(service, ctx.orgId!);
    const connectionState = deriveConnectionState(connection);
    // `disconnected` is exactly the no-row case; the `!connection` also narrows
    // the type so the publish step below needs no non-null assertions.
    if (!connection || connectionState === "disconnected") {
      return NextResponse.json(
        {
          code: "not_connected",
          message:
            "Connect your website in Settings before publishing a Showcase.",
        },
        { status: 409 },
      );
    }
    if (connectionState === "broken") {
      return NextResponse.json(
        {
          code: "connection_broken",
          message:
            "Your website connection needs attention. Reconnect it in Settings, then publish again.",
        },
        { status: 409 },
      );
    }

    // Publish (AC#3). Decrypt the credential at the lib boundary, render the post
    // body from the write-up + the Showcase's ordered photo URLs, then create or
    // update exactly one WordPress post. A recorded wordpress_post_id re-pushes
    // the SAME post — an edit is an update, never a duplicate.
    const credential = {
      siteUrl: connection.site_url,
      username: connection.username,
      applicationPassword: decrypt(connection.application_password_encrypted),
    };
    const photoUrls = await resolveShowcasePhotoUrls(
      ctx.supabase,
      jobId,
      showcase.photo_ids,
    );
    const bodyHtml = renderShowcaseBodyHtml({
      writeUp: showcase.write_up,
      photoUrls,
    });

    // Error mapping (AC#5). A 401 is the only revoked signal — flip the
    // connection broken (so the card prompts a reconnect) and report the DISTINCT
    // invalid_credentials. Every other failure (5xx, network, timeout) is
    // transient: report unreachable and leave the connection untouched.
    let published;
    try {
      published = await publishShowcasePost(
        credential,
        { title: showcase.title, bodyHtml },
        showcase.wordpress_post_id,
      );
    } catch (err) {
      if (isRevokedError(err)) {
        await markBroken(service, connection.id, "Publish rejected (401)");
        return NextResponse.json(
          {
            code: "invalid_credentials",
            message:
              "WordPress rejected the saved credential. Reconnect your website in Settings, then publish again.",
          },
          { status: 422 },
        );
      }
      return NextResponse.json(
        {
          code: "wordpress_unreachable",
          message:
            "Couldn't reach your website. Check that it's online and try again — your connection is unchanged.",
        },
        { status: 502 },
      );
    }

    // Stamp the publish state + the consent audit (who + when). published_at and
    // consent_confirmed_at share one timestamp — they describe the same event.
    const now = new Date().toISOString();
    const { error: stampError } = await ctx.supabase
      .from("showcases")
      .update({
        status: "published",
        wordpress_post_id: published.id,
        wordpress_post_url: published.url,
        published_at: now,
        consent_confirmed_by: ctx.userId,
        consent_confirmed_at: now,
      })
      .eq("id", showcaseId)
      .eq("job_id", jobId);
    if (stampError) {
      return apiDbError(
        stampError.message,
        "POST /api/jobs/[id]/showcases/[showcaseId]/publish",
      );
    }

    return NextResponse.json(
      deriveShowcasePublishState({
        status: "published",
        wordpress_post_url: published.url,
        published_at: now,
      }),
    );
  },
);
