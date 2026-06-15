import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import {
  authorizeTemplateMutation,
  type EmailTemplateScope,
} from "@/lib/email/authorize-template-mutation";
import { sanitizeEmailHtmlForStorage } from "@/lib/email/sanitize-email-html";

// Both handlers derive the template's scope from the existing row (owner_user_id
// NULL → Organization-wide; set → Personal), then apply the same scope gate as
// create. RLS guarantees the loaded row is one the caller may at least see, so a
// 404 here means "not visible to you" as much as "absent". A shared helper keeps
// the load → scope → authorize preamble identical across PUT and DELETE.
async function loadAndAuthorize(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  id: string,
  facts: { role: string | null; grantedPermissions: string[] },
): Promise<
  | { ok: true; scope: EmailTemplateScope }
  | { ok: false; response: Response }
> {
  const { data: existing, error } = await supabase
    .from("email_templates")
    .select("id, owner_user_id")
    .eq("id", id)
    .single();

  if (error || !existing) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Template not found" }, { status: 404 }),
    };
  }

  const scope: EmailTemplateScope =
    existing.owner_user_id === null ? "organization" : "personal";

  if (!authorizeTemplateMutation(scope, facts)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Permission denied" }, { status: 403 }),
    };
  }

  return { ok: true, scope };
}

// PUT /api/email/templates/[id] — edit a template's name and/or body. Scope and
// owner are immutable here; only name and body_html may change.
export const PUT = withRequestContext<{ id: string }>(
  { permission: "access_settings" },
  async (request, ctx, { params }) => {
    const { id } = await params;
    const gate = await loadAndAuthorize(ctx.supabase, id, {
      role: ctx.role,
      grantedPermissions: ctx.grantedPermissions,
    });
    if (!gate.ok) return gate.response;

    const body = await request.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body?.name === "string") patch.name = body.name.trim().slice(0, 200);
    // Same allowlist sanitization as create — body HTML POSTed directly here
    // bypasses the client editor too (issue #658 M3).
    if (typeof body?.body_html === "string")
      patch.body_html = sanitizeEmailHtmlForStorage(body.body_html);

    const { data, error } = await ctx.supabase
      .from("email_templates")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) return apiDbError(error.message, "PUT /api/email/templates/[id]");
    return NextResponse.json(data);
  },
);

// DELETE /api/email/templates/[id] — remove a template.
export const DELETE = withRequestContext<{ id: string }>(
  { permission: "access_settings" },
  async (_request, ctx, { params }) => {
    const { id } = await params;
    const gate = await loadAndAuthorize(ctx.supabase, id, {
      role: ctx.role,
      grantedPermissions: ctx.grantedPermissions,
    });
    if (!gate.ok) return gate.response;

    const { error } = await ctx.supabase
      .from("email_templates")
      .delete()
      .eq("id", id);

    if (error) return apiDbError(error.message, "DELETE /api/email/templates/[id]");
    return NextResponse.json({ ok: true });
  },
);
