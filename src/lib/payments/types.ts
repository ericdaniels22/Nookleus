export type PaymentEmailProvider = "resend" | "email_account";

export interface PaymentEmailSettings {
  id: string;
  send_from_email: string;
  send_from_name: string;
  reply_to_email: string | null;
  provider: PaymentEmailProvider;
  email_account_id: string | null;
  payment_request_subject_template: string;
  payment_request_body_template: string;
  payment_reminder_subject_template: string;
  payment_reminder_body_template: string;
  reminder_day_offsets: number[];
  default_link_expiry_days: number;
  fee_disclosure_text: string | null;
  updated_at: string;
  // Added in build41 (17c)
  payment_receipt_subject_template: string;
  payment_receipt_body_template: string;
  refund_confirmation_subject_template: string;
  refund_confirmation_body_template: string;
  payment_received_internal_subject_template: string;
  payment_received_internal_body_template: string;
  payment_failed_internal_subject_template: string;
  payment_failed_internal_body_template: string;
  refund_issued_internal_subject_template: string;
  refund_issued_internal_body_template: string;
  internal_notification_to_email: string | null;
  // Added in build67c2 — estimate + invoice send templates
  estimate_send_subject_template: string;
  estimate_send_body_template: string;
  invoice_send_subject_template: string;
  invoice_send_body_template: string;
}

// Extras the payment merge-field resolver layers on top of the shared
// customer/job/company resolver — matches the /lib/contracts/email-merge-fields
// EMAIL_EXTRA_MERGE_FIELDS shape.
export const PAYMENT_EMAIL_EXTRA_MERGE_FIELDS = [
  { name: "payment_link", label: "Payment Link" },
  { name: "request_title", label: "Request Title" },
  { name: "amount", label: "Amount (raw)" },
  { name: "amount_formatted", label: "Amount (formatted $)" },
  { name: "card_fee_amount", label: "Card Fee (raw)" },
  { name: "card_fee_formatted", label: "Card Fee (formatted $)" },
  { name: "total_with_fee_formatted", label: "Amount + Card Fee (formatted $)" },
  { name: "link_expires_at", label: "Link Expiration Date" },
  { name: "link_expires_in_days", label: "Link Expires In (days)" },
  { name: "invoice_number", label: "Invoice Number" },
  { name: "invoice_total_formatted", label: "Invoice Total (formatted $)" },
  { name: "invoice_balance_formatted", label: "Invoice Balance (formatted $)" },
] as const;

export type PaymentExtraFieldName =
  typeof PAYMENT_EMAIL_EXTRA_MERGE_FIELDS[number]["name"];

// Shape passed into resolvePaymentEmailTemplate.
export interface PaymentEmailMergeExtras {
  payment_link: string;
  request_title: string;
  amount: string;
  amount_formatted: string;
  card_fee_amount: string | null;
  card_fee_formatted: string | null;
  total_with_fee_formatted: string | null;
  link_expires_at: string | null;
  link_expires_in_days: string | null;
  invoice_number: string | null;
  invoice_total_formatted: string | null;
  invoice_balance_formatted: string | null;
}

export interface PaymentRequestRow {
  id: string;
  organization_id: string;
  job_id: string;
  invoice_id: string | null;
  request_type: "invoice" | "deposit" | "retainer" | "partial";
  title: string;
  amount: number;
  card_fee_amount: number | null;
  total_charged: number | null;
  status:
    | "draft" | "sent" | "viewed" | "paid" | "failed"
    | "refunded" | "partially_refunded" | "expired" | "voided";
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  payment_method_type: "card" | "us_bank_account" | null;
  link_token: string | null;
  link_expires_at: string | null;
  sent_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  reminder_count: number;
  next_reminder_at: string | null;
  voided_at: string | null;
  payer_email: string | null;
  payer_name: string | null;
  created_at: string;
  updated_at: string;
  // Added in build41 (17c)
  stripe_receipt_url: string | null;
  qb_payment_id: string | null;
  quickbooks_sync_status: "pending" | "synced" | "failed" | "not_applicable" | null;
  quickbooks_sync_attempted_at: string | null;
  quickbooks_sync_error: string | null;
}

export interface PaymentRow {
  id: string;
  organization_id: string;
  job_id: string;
  invoice_id: string | null;
  payment_request_id: string | null;
  source: "insurance" | "homeowner" | "other" | "stripe";
  method:
    | "check"
    | "ach"
    | "venmo_zelle"
    | "cash"
    | "credit_card"
    | "stripe_card"
    | "stripe_ach";
  amount: number;
  reference_number: string | null;
  payer_name: string | null;
  status: "received" | "pending" | "due" | "refunded";
  notes: string | null;
  received_date: string | null;
  created_at: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_fee_amount: number | null;
  net_amount: number | null;
  qb_payment_id: string | null;
  quickbooks_sync_status: "pending" | "synced" | "failed" | "not_applicable" | null;
  quickbooks_sync_attempted_at: string | null;
  quickbooks_sync_error: string | null;
}

export interface RefundRow {
  id: string;
  organization_id: string;
  payment_id: string;
  payment_request_id: string | null;
  amount: number;
  reason: string | null;
  include_reason_in_customer_email: boolean;
  notify_customer: boolean;
  stripe_refund_id: string | null;
  status: "pending" | "succeeded" | "failed" | "canceled";
  failure_reason: string | null;
  refunded_by: string | null;
  created_at: string;
  refunded_at: string | null;
}

export interface StripeDisputeRow {
  id: string;
  organization_id: string;
  payment_id: string | null;
  payment_request_id: string | null;
  stripe_dispute_id: string;
  amount: number | null;
  reason: string | null;
  status:
    | "warning_needs_response"
    | "warning_under_review"
    | "warning_closed"
    | "needs_response"
    | "under_review"
    | "won"
    | "lost"
    | null;
  evidence_due_by: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  type:
    // 14g legacy types
    | "new_job"
    | "status_change"
    | "payment"
    | "activity"
    | "photo"
    | "email"
    | "overdue"
    | "reminder"
    // 17c new types
    | "payment_received"
    | "payment_failed"
    | "refund_issued"
    | "dispute_opened"
    | "qb_sync_failed";
  title: string;
  body: string | null;
  is_read: boolean;
  job_id: string | null;
  href: string | null;
  priority: "normal" | "high";
  metadata: Record<string, unknown>;
  created_at: string;
}
