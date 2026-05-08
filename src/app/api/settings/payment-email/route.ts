import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requirePermission } from "@/lib/permissions-api";
import type {
  PaymentEmailProvider,
  PaymentEmailSettings,
} from "@/lib/payments/types";

async function getSettings() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("payment_email_settings")
    .select("*")
    .limit(1)
    .maybeSingle<PaymentEmailSettings>();
  return { supabase, data, error };
}

export async function GET() {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "access_settings");
  if (!gate.ok) return gate.response;

  const { data, error } = await getSettings();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "payment_email_settings row missing — did the build40 migration run?" },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "access_settings");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as
    | Partial<PaymentEmailSettings>
    | null;
  if (!body) {
    return NextResponse.json(
      { error: "Body must be a JSON object" },
      { status: 400 },
    );
  }

  const { supabase, data: current, error: fetchErr } = await getSettings();
  if (fetchErr)
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!current) {
    return NextResponse.json(
      { error: "payment_email_settings row missing — did the build40 migration run?" },
      { status: 500 },
    );
  }

  const patch: Partial<PaymentEmailSettings> = {};
  const stringFields: Array<keyof PaymentEmailSettings> = [
    "send_from_email",
    "send_from_name",
    "payment_request_subject_template",
    "payment_request_body_template",
    "payment_reminder_subject_template",
    "payment_reminder_body_template",
    "payment_receipt_subject_template",
    "payment_receipt_body_template",
    "refund_confirmation_subject_template",
    "refund_confirmation_body_template",
    "payment_received_internal_subject_template",
    "payment_received_internal_body_template",
    "payment_failed_internal_subject_template",
    "payment_failed_internal_body_template",
    "refund_issued_internal_subject_template",
    "refund_issued_internal_body_template",
    // Build 67c2 — estimate + invoice send templates
    "estimate_send_subject_template",
    "estimate_send_body_template",
    "invoice_send_subject_template",
    "invoice_send_body_template",
  ];
  for (const f of stringFields) {
    const v = body[f];
    if (typeof v === "string") {
      if (v.length > 5000) {
        return NextResponse.json(
          { error: `${f} exceeds 5000 char limit` },
          { status: 400 },
        );
      }
      (patch as Record<string, unknown>)[f] = v;
    }
  }
  if (
    body.internal_notification_to_email === null ||
    typeof body.internal_notification_to_email === "string"
  ) {
    patch.internal_notification_to_email =
      body.internal_notification_to_email || null;
  }
  if (body.reply_to_email === null || typeof body.reply_to_email === "string") {
    patch.reply_to_email = body.reply_to_email || null;
  }
  if (body.provider === "resend" || body.provider === "email_account") {
    patch.provider = body.provider as PaymentEmailProvider;
  }
  if (
    body.email_account_id === null ||
    typeof body.email_account_id === "string"
  ) {
    patch.email_account_id = body.email_account_id || null;
  }
  if (Array.isArray(body.reminder_day_offsets)) {
    const offsets = body.reminder_day_offsets
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 60);
    patch.reminder_day_offsets = offsets;
  }
  if (typeof body.default_link_expiry_days === "number") {
    const d = Math.round(body.default_link_expiry_days);
    if (d < 1 || d > 30) {
      return NextResponse.json(
        { error: "default_link_expiry_days must be between 1 and 30" },
        { status: 400 },
      );
    }
    patch.default_link_expiry_days = d;
  }
  if (body.fee_disclosure_text === null || typeof body.fee_disclosure_text === "string") {
    patch.fee_disclosure_text = body.fee_disclosure_text || null;
  }

  if (
    patch.provider === "email_account" &&
    !patch.email_account_id &&
    !current.email_account_id
  ) {
    return NextResponse.json(
      {
        error:
          "Select an email account before switching provider to email_account",
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("payment_email_settings")
    .update(patch)
    .eq("id", current.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
