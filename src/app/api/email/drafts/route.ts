import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { sanitizeEmailHtmlForStorage } from "@/lib/email/sanitize-email-html";
import { reconcileDraftAttachments } from "@/lib/email/draft-attachments";

// POST /api/email/drafts — save or update a draft
// Body: { draftId?, accountId, to, cc, bcc, subject, bodyText, bodyHtml, jobId?, replyToMessageId?, attachments? }
// Requires `send_email` (#105, PRD #95) — tightened from the logged-in-only
// gate the #85 Request-Context conversion gave this previously-ungated route.
export const POST = withRequestContext({ permission: "send_email" }, async (request, ctx) => {
  const {
    draftId,
    accountId,
    to,
    cc,
    bcc,
    subject,
    bodyText,
    bodyHtml,
    jobId,
    replyToMessageId,
    attachments,
  } = await request.json();

  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  // Get account for from address + org scope
  const { data: account } = await ctx.supabase
    .from("email_accounts")
    .select("email_address, display_name, organization_id")
    .eq("id", accountId)
    .single();

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const toAddresses = to
    ? to.split(",").map((e: string) => ({ email: e.trim() }))
    : [];
  const ccAddresses = cc
    ? cc.split(",").map((e: string) => ({ email: e.trim() }))
    : [];
  const bccAddresses = bcc
    ? bcc.split(",").map((e: string) => ({ email: e.trim() }))
    : [];
  const snippet = (bodyText || "").replace(/\s+/g, " ").trim().slice(0, 200);

  const draftData = {
    organization_id: account.organization_id,
    account_id: accountId,
    job_id: jobId || null,
    message_id: draftId || `draft-${Date.now()}`,
    thread_id: replyToMessageId || null,
    folder: "drafts" as const,
    from_address: account.email_address,
    from_name: account.display_name || null,
    to_addresses: toAddresses,
    cc_addresses: ccAddresses,
    bcc_addresses: bccAddresses,
    subject: subject || "(no subject)",
    body_text: bodyText || null,
    // Allowlist-sanitize before storage so a body POSTed directly (bypassing
    // the client Tiptap round-trip) can't smuggle script/handlers into a
    // resumed draft or the eventual send (issue #658 M3). Storage variant keeps
    // the signature round-trip markers so a resumed draft can still swap them.
    body_html: bodyHtml ? sanitizeEmailHtmlForStorage(bodyHtml) : null,
    snippet: snippet || null,
    is_read: true,
    is_starred: false,
    // Report attachments honestly so the Drafts list shows the paperclip and
    // doesn't claim "no attachments" for a draft that has them (issue #657 L1).
    // NOTE: this only records the FLAG; persisting the email_attachments rows so
    // a resumed draft re-hydrates its files is tracked as a follow-up.
    has_attachments: Array.isArray(attachments) && attachments.length > 0,
    matched_by: jobId ? ("job_id" as const) : null,
    received_at: new Date().toISOString(),
  };

  let emailId: string;
  if (draftId) {
    // Update existing draft
    const { data, error } = await ctx.supabase
      .from("emails")
      .update(draftData)
      .eq("id", draftId)
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    emailId = data.id;
  } else {
    // Create new draft
    const { data, error } = await ctx.supabase
      .from("emails")
      .insert(draftData)
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    emailId = data.id;
  }

  // Persist the attachment rows so a resumed draft re-hydrates its files
  // (issue #663). Reconcile against what's already stored on every autosave:
  // newly-attached files are inserted, removed files deleted, and unchanged
  // files left alone so repeated autosaves never duplicate rows. `storage_path`
  // is the identity — the upload route mints a unique one per file. (Sending or
  // discarding the draft cleans these up via email_attachments' ON DELETE
  // CASCADE on the emails row.)
  const currentAttachments = Array.isArray(attachments) ? attachments : [];
  const { data: previousRows } = await ctx.supabase
    .from("email_attachments")
    .select("id, storage_path")
    .eq("email_id", emailId);
  const { toInsert, toDeleteIds } = reconcileDraftAttachments(
    previousRows ?? [],
    currentAttachments,
  );
  if (toInsert.length > 0) {
    await ctx.supabase.from("email_attachments").insert(
      toInsert.map((a) => ({
        organization_id: account.organization_id,
        email_id: emailId,
        filename: a.filename,
        content_type: a.content_type,
        file_size: a.file_size,
        storage_path: a.storage_path,
      })),
    );
  }
  if (toDeleteIds.length > 0) {
    await ctx.supabase.from("email_attachments").delete().in("id", toDeleteIds);
  }

  return NextResponse.json({ id: emailId, [draftId ? "updated" : "created"]: true });
});
