import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import {
  authorizeTemplateMutation,
  type EmailTemplateScope,
} from "@/lib/email/authorize-template-mutation";
import { sanitizeEmailHtmlForStorage } from "@/lib/email/sanitize-email-html";

// GET /api/email/templates — list the templates this Request Context may see:
// Organization-wide templates for the Active Organization plus the caller's
// own Personal templates. The visibility rule itself is enforced by RLS
// (migration-572); the route only needs the Settings-reach gate.
export const GET = withRequestContext({ permission: "access_settings" }, async (_request, ctx) => {
  const { data, error } = await ctx.supabase
    .from("email_templates")
    .select("id, name, body_html, owner_user_id, created_by, created_at, updated_at")
    .eq("organization_id", ctx.orgId)
    .order("updated_at", { ascending: false });

  if (error) return apiDbError(error.message, "GET /api/email/templates");
  return NextResponse.json(data ?? []);
});

// POST /api/email/templates — create a template in one of two scopes:
//   { scope: "organization" } → org-wide; requires manage_email_templates
//   { scope: "personal" }     → owned by the caller; always allowed
// The route gate is the looser access_settings (reaching the feature at all);
// the scope-specific permission is decided by authorizeTemplateMutation, the
// one rule RLS cannot enforce because Nookleus' granular grants aren't in the
// JWT. The owner is computed server-side, never honored from the request body.
export const POST = withRequestContext({ permission: "access_settings" }, async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const scope: EmailTemplateScope =
    body?.scope === "organization" ? "organization" : "personal";

  if (
    !authorizeTemplateMutation(scope, {
      role: ctx.role,
      grantedPermissions: ctx.grantedPermissions,
    })
  ) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const name = (body?.name ?? "").toString().trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from("email_templates")
    .insert({
      organization_id: ctx.orgId,
      owner_user_id: scope === "organization" ? null : ctx.userId,
      name: name.slice(0, 200),
      // Allowlist-sanitize before storage: an org-shared template body flows
      // into other members' outgoing email, so a body POSTed directly must not
      // carry script/handlers (issue #658 M3). Storage variant keeps the
      // round-trip markers; the send path strips them.
      body_html: sanitizeEmailHtmlForStorage((body?.body_html ?? "").toString()),
      created_by: ctx.userId,
    })
    .select()
    .single();

  if (error) return apiDbError(error.message, "POST /api/email/templates insert");
  return NextResponse.json(data, { status: 201 });
});
