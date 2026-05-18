import { createServiceClient } from "@/lib/supabase-api";
import { resolvePaymentEmailTemplate } from "@/lib/payments/merge-fields";
import { sendPaymentEmail } from "@/lib/payments/email";
import { writePaymentEvent } from "@/lib/payments/activity";
import type {
  PaymentEmailSettings,
  PaymentRequestRow,
} from "@/lib/payments/types";
import type { PaymentMergeExtras } from "@/lib/payments/merge-fields";
import type { Attachment } from "@/lib/payments/email";
import { generateReceiptPdf } from "@/lib/payments/receipt-pdf";

interface StripeConnectionFees {
  pass_card_fee_to_customer: boolean;
  card_fee_percent: number;
}

// Computes the first reminder timestamp given send-time + offsets.
// Mirrors src/lib/contracts/reminders.ts#computeInitialNextReminderAt so
// future cron code can share the same signal.
export function computeInitialNextReminderAt(
  sentAt: Date,
  offsets: number[],
): Date | null {
  const valid = (offsets ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!valid.length) return null;
  const first = Math.min(...valid);
  return new Date(sentAt.getTime() + first * 24 * 60 * 60 * 1000);
}

async function loadSettings(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<PaymentEmailSettings> {
  const { data, error } = await supabase
    .from("payment_email_settings")
    .select("*")
    .limit(1)
    .maybeSingle<PaymentEmailSettings>();
  if (error) throw new Error(error.message);
  if (!data)
    throw new Error(
      "payment_email_settings row missing — did the build40 migration run?",
    );
  if (!data.send_from_email || !data.send_from_name) {
    throw new Error(
      "Set a send-from email and display name in Settings → Payment Emails before sending.",
    );
  }
  return data;
}

async function loadPaymentRequest(
  supabase: ReturnType<typeof createServiceClient>,
  paymentRequestId: string,
): Promise<PaymentRequestRow> {
  const { data, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", paymentRequestId)
    .maybeSingle<PaymentRequestRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`payment_request ${paymentRequestId} not found`);
  return data;
}

async function loadRecipient(
  supabase: ReturnType<typeof createServiceClient>,
  pr: PaymentRequestRow,
): Promise<{ email: string; name: string | null }> {
  if (pr.payer_email) {
    return { email: pr.payer_email, name: pr.payer_name };
  }
  const { data: job } = await supabase
    .from("jobs")
    .select("contact_id")
    .eq("id", pr.job_id)
    .maybeSingle<{ contact_id: string | null }>();
  if (!job?.contact_id) {
    throw new Error(
      "No customer email on file — set a contact email on the job before sending.",
    );
  }
  const { data: contact } = await supabase
    .from("contacts")
    .select("email, full_name")
    .eq("id", job.contact_id)
    .maybeSingle<{
      email: string | null;
      full_name: string | null;
    }>();
  if (!contact?.email) {
    throw new Error(
      "Customer contact has no email address — cannot send payment request.",
    );
  }
  const name = contact.full_name?.trim() || null;
  return { email: contact.email, name };
}

async function loadStripeFees(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<StripeConnectionFees | null> {
  const { data } = await supabase
    .from("stripe_connection")
    .select("pass_card_fee_to_customer, card_fee_percent")
    .limit(1)
    .maybeSingle<StripeConnectionFees>();
  return data ?? null;
}

export async function sendPaymentRequestEmail(
  paymentRequestId: string,
): Promise<{ messageId: string; provider: "resend" | "smtp" }> {
  const supabase = createServiceClient();
  const [settings, pr, fees] = await Promise.all([
    loadSettings(supabase),
    loadPaymentRequest(supabase, paymentRequestId),
    loadStripeFees(supabase),
  ]);
  const recipient = await loadRecipient(supabase, pr);

  const { subject, html } = await resolvePaymentEmailTemplate(
    supabase,
    settings.payment_request_subject_template,
    settings.payment_request_body_template,
    pr,
    { stripeConnection: fees },
  );

  const sent = await sendPaymentEmail(supabase, settings, {
    to: recipient.email,
    subject,
    html,
  });

  // Status + timestamp transition. On first send only.
  const firstReminder = computeInitialNextReminderAt(
    new Date(),
    settings.reminder_day_offsets,
  );
  const { error: upErr } = await supabase
    .from("payment_requests")
    .update({
      status: pr.status === "draft" ? "sent" : pr.status,
      sent_at: pr.sent_at ?? new Date().toISOString(),
      next_reminder_at: firstReminder
        ? firstReminder.toISOString()
        : pr.next_reminder_at,
      payer_email: pr.payer_email ?? recipient.email,
      payer_name: pr.payer_name ?? recipient.name,
    })
    .eq("id", pr.id);
  if (upErr) {
    // Email already went out — surface but keep the DB state best-effort.
    throw new Error(
      `Email sent (message ${sent.messageId}) but status update failed: ${upErr.message}`,
    );
  }

  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "sent",
    metadata: { provider: sent.provider, message_id: sent.messageId },
  });

  return sent;
}

export async function sendPaymentReminderEmail(
  paymentRequestId: string,
): Promise<{ messageId: string; provider: "resend" | "smtp" }> {
  const supabase = createServiceClient();
  const [settings, pr, fees] = await Promise.all([
    loadSettings(supabase),
    loadPaymentRequest(supabase, paymentRequestId),
    loadStripeFees(supabase),
  ]);
  if (pr.status !== "sent" && pr.status !== "viewed") {
    throw new Error(
      `Cannot send reminder: payment_request status is ${pr.status}`,
    );
  }
  const recipient = await loadRecipient(supabase, pr);
  const { subject, html } = await resolvePaymentEmailTemplate(
    supabase,
    settings.payment_reminder_subject_template,
    settings.payment_reminder_body_template,
    pr,
    { stripeConnection: fees },
  );
  const sent = await sendPaymentEmail(supabase, settings, {
    to: recipient.email,
    subject,
    html,
  });
  await supabase
    .from("payment_requests")
    .update({
      reminder_count: pr.reminder_count + 1,
    })
    .eq("id", pr.id);
  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "reminder_sent",
    metadata: { provider: sent.provider, message_id: sent.messageId },
  });
  return sent;
}

export interface ReceiptEmailInput {
  paymentRequestId: string;
  extras: PaymentMergeExtras;
  attachment?: Attachment;
}

export async function sendPaymentReceiptEmail(
  input: ReceiptEmailInput,
): Promise<{ messageId: string; provider: "resend" | "smtp" }> {
  const supabase = createServiceClient();
  const [settings, pr, fees] = await Promise.all([
    loadSettings(supabase),
    loadPaymentRequest(supabase, input.paymentRequestId),
    loadStripeFees(supabase),
  ]);
  const recipient = await loadRecipient(supabase, pr);

  const { subject, html } = await resolvePaymentEmailTemplate(
    supabase,
    settings.payment_receipt_subject_template,
    settings.payment_receipt_body_template,
    pr,
    { stripeConnection: fees, extras: input.extras },
  );

  // Build attachment. Keep the generated Buffer around so we can upload it
  // to Storage *after* the email succeeds — that way receipt_pdf_path is
  // a reliable signal of "we emailed this PDF".
  let attachments: Attachment[] = [];
  let generatedPdf: Buffer | null = null;
  if (input.attachment) {
    attachments = [input.attachment];
  } else {
    try {
      const pdf = await generateReceiptPdf(supabase, {
        paymentRequestId: pr.id,
        methodDisplay: extraMethodDisplay(input.extras),
        transactionIdDisplay: input.extras.transaction_id
          ? `…${input.extras.transaction_id.slice(-12)}`
          : "—",
        stripeFeeAmount: input.extras.stripe_fee_amount ?? null,
        netAmount: input.extras.net_amount ?? null,
      });
      generatedPdf = pdf;
      attachments = [
        {
          filename: `receipt-${pr.id.slice(0, 8)}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ];
    } catch (e) {
      console.warn(
        `receipt PDF generation failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  const sent = await sendPaymentEmail(supabase, settings, {
    to: recipient.email,
    subject,
    html,
    attachments,
  });

  // After email is safely sent, persist the PDF to Storage + update the
  // admin-facing receipt_pdf_path. Best-effort: Supabase Storage .upload()
  // does not throw — it returns { data, error }.
  if (generatedPdf) {
    const storagePath = `${pr.job_id}/${pr.id}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from("receipts")
      .upload(storagePath, generatedPdf, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadErr) {
      console.warn(
        `receipt PDF storage upload failed: ${uploadErr.message}`,
      );
    } else {
      const { error: updateErr } = await supabase
        .from("payment_requests")
        .update({ receipt_pdf_path: storagePath })
        .eq("id", pr.id);
      if (updateErr) {
        console.warn(
          `receipt_pdf_path update failed: ${updateErr.message}`,
        );
      }
    }
  }

  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "email_delivered",
    metadata: {
      kind: "receipt",
      provider: sent.provider,
      message_id: sent.messageId,
    },
  });

  return sent;
}

function extraMethodDisplay(extras: PaymentMergeExtras): string {
  if (extras.payment_method_type === "us_bank_account") {
    return extras.bank_name ? `Bank transfer (${extras.bank_name})` : "Bank transfer (ACH)";
  }
  if (extras.payment_method_type === "card") {
    const brand = extras.card_brand
      ? extras.card_brand
          .split("_")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
      : "Card";
    return extras.card_last4 ? `${brand} ending in ${extras.card_last4}` : brand;
  }
  return "—";
}

export type InternalNotificationKind =
  | "payment_received"
  | "payment_failed"
  | "refund_issued"
  | "dispute_opened";

export interface InternalNotificationInput {
  paymentRequestId: string;
  kind: InternalNotificationKind;
  extras: PaymentMergeExtras;
  subjectPrefix?: string;
}

export async function sendPaymentInternalNotification(
  input: InternalNotificationInput,
): Promise<{ messageId: string; provider: "resend" | "smtp" } | null> {
  const supabase = createServiceClient();
  const [settings, pr] = await Promise.all([
    loadSettings(supabase),
    loadPaymentRequest(supabase, input.paymentRequestId),
  ]);

  const to = settings.internal_notification_to_email || settings.send_from_email;
  if (!to) return null;

  const { subjectTpl, bodyTpl } = (() => {
    switch (input.kind) {
      case "payment_received":
        return {
          subjectTpl: settings.payment_received_internal_subject_template,
          bodyTpl: settings.payment_received_internal_body_template,
        };
      case "dispute_opened":
        // dispute reuses payment_failed_internal_* template + subject override
        return {
          subjectTpl: settings.payment_failed_internal_subject_template,
          bodyTpl: settings.payment_failed_internal_body_template,
        };
      case "payment_failed":
        return {
          subjectTpl: settings.payment_failed_internal_subject_template,
          bodyTpl: settings.payment_failed_internal_body_template,
        };
      case "refund_issued":
        return {
          subjectTpl: settings.refund_issued_internal_subject_template,
          bodyTpl: settings.refund_issued_internal_body_template,
        };
    }
  })();

  const { subject, html } = await resolvePaymentEmailTemplate(
    supabase,
    subjectTpl,
    bodyTpl,
    pr,
    { extras: input.extras },
  );

  const finalSubject = input.subjectPrefix
    ? `${input.subjectPrefix}${subject}`
    : subject;

  const sent = await sendPaymentEmail(supabase, settings, {
    to,
    subject: finalSubject,
    html,
  });

  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "email_delivered",
    metadata: {
      kind: `internal_${input.kind}`,
      provider: sent.provider,
      message_id: sent.messageId,
    },
  });

  return sent;
}

export interface RefundConfirmationInput {
  paymentRequestId: string;
  extras: PaymentMergeExtras;
}

export async function sendRefundConfirmationEmail(
  input: RefundConfirmationInput,
): Promise<{ messageId: string; provider: "resend" | "smtp" }> {
  const supabase = createServiceClient();
  const [settings, pr, fees] = await Promise.all([
    loadSettings(supabase),
    loadPaymentRequest(supabase, input.paymentRequestId),
    loadStripeFees(supabase),
  ]);
  const recipient = await loadRecipient(supabase, pr);

  const { subject, html } = await resolvePaymentEmailTemplate(
    supabase,
    settings.refund_confirmation_subject_template,
    settings.refund_confirmation_body_template,
    pr,
    { stripeConnection: fees, extras: input.extras },
  );

  const sent = await sendPaymentEmail(supabase, settings, {
    to: recipient.email,
    subject,
    html,
  });

  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "email_delivered",
    metadata: {
      kind: "refund_confirmation",
      provider: sent.provider,
      message_id: sent.messageId,
    },
  });

  return sent;
}
