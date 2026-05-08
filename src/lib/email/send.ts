// Build 67c2 — generic org-scoped send.
//
// This is intentionally a third near-copy of the Resend / SMTP send code.
// The duplication with src/lib/payments/email.ts and src/lib/contracts/email.ts
// is queued as a separate cleanup chip; consolidation requires migrating
// existing callers, which is risk for the live payments + contracts flows.

import { Resend } from "resend";
import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";
import type { PaymentEmailSettings } from "@/lib/payments/types";

export interface Attachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendResult {
  messageId: string;
  provider: "resend" | "smtp";
}

export interface SendOrgEmailArgs {
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
}

export class FromUnconfiguredError extends Error {
  constructor() {
    super("send_from_email is empty for this organization");
    this.name = "FromUnconfiguredError";
  }
}

export async function loadOrgEmailSettings(
  supabase: SupabaseClient,
  orgId: string,
): Promise<PaymentEmailSettings | null> {
  const { data } = await supabase
    .from("payment_email_settings")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle<PaymentEmailSettings>();
  return data;
}

function formatFromHeader(name: string, address: string): string {
  return `"${name.replace(/"/g, '\\"')}" <${address}>`;
}

function requireResendKey(): string {
  const k = process.env.RESEND_API_KEY;
  if (!k) throw new Error("RESEND_API_KEY is not set");
  return k;
}

export async function sendOrgEmail(
  supabase: SupabaseClient,
  orgId: string,
  args: SendOrgEmailArgs,
): Promise<SendResult> {
  const settings = await loadOrgEmailSettings(supabase, orgId);
  if (!settings) {
    throw new Error(`payment_email_settings row missing for org ${orgId}`);
  }
  if (!settings.send_from_email) {
    throw new FromUnconfiguredError();
  }

  const { to, subject, html, attachments = [] } = args;
  if (!to) throw new Error("sendOrgEmail: 'to' is required");
  if (!subject) throw new Error("sendOrgEmail: 'subject' is required");

  if (settings.provider === "resend") {
    const resend = new Resend(requireResendKey());
    const { data, error } = await resend.emails.send({
      from: formatFromHeader(
        settings.send_from_name || "Outgoing",
        settings.send_from_email,
      ),
      to,
      subject,
      html,
      replyTo: settings.reply_to_email || undefined,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: a.content.toString("base64"),
      })),
    });
    if (error) throw new Error(`Resend error: ${error.message}`);
    if (!data?.id) throw new Error("Resend did not return a message id");
    return { messageId: data.id, provider: "resend" };
  }

  if (settings.provider === "email_account") {
    if (!settings.email_account_id) {
      throw new Error(
        "Provider is email_account but no email_account_id is configured",
      );
    }
    const { data: account, error } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", settings.email_account_id)
      .single();
    if (error || !account) {
      throw new Error(
        `Email account ${settings.email_account_id} not found for SMTP send`,
      );
    }

    let password: string;
    try {
      password = decrypt(account.encrypted_password);
    } catch (e) {
      throw new Error(
        `Failed to decrypt email account password: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    const fromName =
      settings.send_from_name || account.display_name || "Outgoing";
    const fromEmail = settings.send_from_email || account.email_address;

    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: { user: account.username, pass: password },
      tls: {
        rejectUnauthorized:
          process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === "true",
      },
    });

    try {
      const info = await transporter.sendMail({
        from: formatFromHeader(fromName, fromEmail),
        to,
        replyTo: settings.reply_to_email || undefined,
        subject,
        html,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      return {
        messageId: info.messageId || `smtp-${Date.now()}`,
        provider: "smtp",
      };
    } finally {
      transporter.close();
    }
  }

  throw new Error(`Unknown email provider: ${settings.provider}`);
}
