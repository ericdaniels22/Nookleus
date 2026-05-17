import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// Logged-in only — matches the route's prior cookie-auth check. Reads and
// writes the marketing-draft queue with the Service client, org-scoped to
// the Active Organization.
export const GET = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const supabase = ctx.serviceClient!;
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get("platform");
    const status = searchParams.get("status");

    let query = supabase
      .from("marketing_drafts")
      .select("*, image:marketing_assets!image_id(*)")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false });

    if (platform) {
      query = query.eq("platform", platform);
    }
    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ drafts: data || [] });
  },
);

// POST is intentionally NOT routed through withRequestContext: it accepts
// either cookie auth OR an internal service-key call (the marketing AI
// department saves drafts this way). The wrapper requires a logged-in
// user, which the service-key path has none of, so this dual-mode handler
// stays on its inline check. Tracked for the #78 ungated-endpoint list as
// an internally-authenticated endpoint.
export async function POST(request: Request) {
  // Accept either cookie auth OR internal service key (for AI tool calls)
  const internalKey = request.headers.get("x-service-key");
  const isInternalCall =
    internalKey && internalKey === process.env.SUPABASE_SERVICE_ROLE_KEY;

  const authSupabase = await createServerSupabaseClient();
  if (!isInternalCall) {
    const { data: { user }, error: authError } = await authSupabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json();
  const { platform, caption, hashtags, image_id, image_brief, conversation_id, created_by } = body;

  if (!platform || !caption) {
    return NextResponse.json(
      { error: "platform and caption are required" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("marketing_drafts")
    .insert({
      organization_id: await getActiveOrganizationId(authSupabase),
      platform,
      caption,
      hashtags: hashtags || null,
      image_id: image_id || null,
      image_brief: image_brief || null,
      status: "draft",
      conversation_id: conversation_id || null,
      created_by: created_by || null,
    })
    .select("*, image:marketing_assets!image_id(*)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft: data });
}

export const PATCH = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const supabase = ctx.serviceClient!;

    // Only allow specific fields to be updated
    const allowed: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.caption !== undefined) allowed.caption = updates.caption;
    if (updates.hashtags !== undefined) allowed.hashtags = updates.hashtags;
    if (updates.status !== undefined) allowed.status = updates.status;
    if (updates.image_id !== undefined) allowed.image_id = updates.image_id || null;
    if (updates.image_brief !== undefined) allowed.image_brief = updates.image_brief;
    if (updates.posted_at !== undefined) allowed.posted_at = updates.posted_at;

    const { data, error } = await supabase
      .from("marketing_drafts")
      .update(allowed)
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .select("*, image:marketing_assets!image_id(*)")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ draft: data });
  },
);

export const DELETE = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { error } = await ctx.serviceClient!
      .from("marketing_drafts")
      .delete()
      .eq("id", id)
      .eq("organization_id", ctx.orgId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  },
);
