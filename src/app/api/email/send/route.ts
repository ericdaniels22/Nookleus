import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { decrypt } from "@/lib/encryption";
import nodemailer from "nodemailer";

interface UploadedAttachment {
  filename: string;
  content_type: string;
  file_size: number;
  storage_path: string;
}

// POST /api/email/send
// Body: { accountId, to, subject, body, bodyHtml?, cc?, bcc?, jobId?, replyToMessageId?, attachments? }
// Requires `send_email` (#105, PRD #95) — tightened from the logged-in-only
// gate the #85 Request-Context conversion gave this previously-ungated route.
export const POST = withRequestContext({ permission: "send_email" }, async (request, ctx) => {
  const { accountId, jobId, to, cc, bcc, subject, body, bodyHtml, replyToMessageId, attachments, draftId } =
    await request.json() as {
      accountId: string; jobId?: string; to: string; cc?: string; bcc?: string;
      subject: string; body: string; bodyHtml?: string; replyToMessageId?: string;
      attachments?: UploadedAttachment[]; draftId?: string;
    };

  if (!accountId || !to || !subject || !body) {
    return NextResponse.json(
      { error: "accountId, to, subject, and body are required" },
      { status: 400 }
    );
  }

  const supabase = ctx.supabase;

  // Get account
  const { data: account, error: accError } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (accError || !account) {
    return NextResponse.json({ error: "Email account not found" }, { status: 404 });
  }

  let password: string;
  try {
    password = decrypt(account.encrypted_password);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to decrypt password: ${err instanceof Error ? err.message : "check ENCRYPTION_KEY"}` },
      { status: 500 }
    );
  }

  const displayName = account.display_name || "AAA Disaster Recovery";

  // Build headers for reply threading
  const headers: Record<string, string> = {};
  if (replyToMessageId) {
    headers["In-Reply-To"] = replyToMessageId;
    headers["References"] = replyToMessageId;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: { user: account.username, pass: password },
      tls: { rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === "true" },
    });

    const mailOptions: Record<string, unknown> = {
      from: `"${displayName}" <${account.email_address}>`,
      to,
      subject,
      text: body,
      headers,
    };

    if (cc) mailOptions.cc = cc;
    if (bcc) mailOptions.bcc = bcc;
    if (bodyHtml) mailOptions.html = bodyHtml;

    // Attach files from storage
    if (attachments && attachments.length > 0) {
      const mailAttachments = [];
      for (const att of attachments) {
        const { data: fileData } = await supabase.storage
          .from("email-attachments")
          .download(att.storage_path);
        if (fileData) {
          const buffer = Buffer.from(await fileData.arrayBuffer());
          mailAttachments.push({
            filename: att.filename,
            content: buffer,
            contentType: att.content_type,
          });
        }
      }
      mailOptions.attachments = mailAttachments;
    }

    const info = await transporter.sendMail(mailOptions);
    transporter.close();

    // Parse recipient addresses into arrays
    const toAddresses = to.split(",").map((e: string) => ({ email: e.trim() }));
    const ccAddresses = cc
      ? cc.split(",").map((e: string) => ({ email: e.trim() }))
      : [];
    const bccAddresses = bcc
      ? bcc.split(",").map((e: string) => ({ email: e.trim() }))
      : [];

    // Save to emails table
    const messageId = info.messageId || `sent-${Date.now()}`;
    const snippet = body.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);

    const hasAttachments = (attachments?.length || 0) > 0;
    const { data: savedEmail, error: insertError } = await supabase
      .from("emails")
      .insert({
        organization_id: account.organization_id,
        account_id: accountId,
        job_id: jobId || null,
        message_id: messageId,
        thread_id: replyToMessageId || messageId,
        folder: "sent",
        from_address: account.email_address,
        from_name: displayName,
        to_addresses: toAddresses,
        cc_addresses: ccAddresses,
        bcc_addresses: bccAddresses,
        subject,
        body_text: body,
        body_html: bodyHtml || null,
        snippet,
        is_read: true,
        is_starred: false,
        has_attachments: hasAttachments,
        matched_by: jobId ? "job_id" : null,
        received_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: `Email sent but failed to save: ${insertError.message}` },
        { status: 500 }
      );
    }

    // Move attachment files from drafts/ to sent email folder and save metadata
    if (savedEmail && attachments && attachments.length > 0) {
      for (const att of attachments) {
        const newPath = `${account.organization_id}/${accountId}/${savedEmail.id}/${att.filename}`;
        await supabase.storage.from("email-attachments").move(att.storage_path, newPath);
        await supabase.from("email_attachments").insert({
          organization_id: account.organization_id,
          email_id: savedEmail.id,
          filename: att.filename,
          content_type: att.content_type,
          file_size: att.file_size,
          storage_path: newPath,
        });
      }
    }

    // Delete draft if this was sent from a saved draft
    if (draftId) {
      await supabase.from("emails").delete().eq("id", draftId).eq("folder", "drafts");
    }

    return NextResponse.json({ success: true, messageId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email" },
      { status: 500 }
    );
  }
});
