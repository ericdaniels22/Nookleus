import type {
  CoverBlockVisibility,
  StoredReportSettingsJson,
} from "./photo-report-settings";

export interface Contact {
  id: string;
  /** Owning Organization. NOT NULL in the DB and enforced by RLS. */
  organization_id: string;
  /** Canonical customer name — the sole name column on `contacts` (PRD #109). */
  full_name: string;
  phone: string | null;
  email: string | null;
  // `referral_contact` (PRD #249, issue #250 migration build78) identifies
  // a contact that belongs to a Referral Partner company — surfaced on
  // the Call Worksheet's "Contacts at this company" list and the
  // Contacts tab's Referral Contact badge (issue #255).
  role:
    | "homeowner"
    | "tenant"
    | "property_manager"
    | "adjuster"
    | "insurance"
    | "referral_contact";
  company: string | null;
  title: string | null;
  notes: string | null;
  /** FK to a `referral_partners` row when role = 'referral_contact'. ON
   *  DELETE SET NULL so a hard-deleted partner leaves its people behind
   *  as orphans rather than dragging them out of /contacts. */
  referral_partner_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  /** Owning Organization. NOT NULL in the DB and enforced by RLS. */
  organization_id: string;
  job_number: string;
  contact_id: string;
  status: string;
  urgency: "emergency" | "urgent" | "scheduled";
  damage_type: string;
  damage_source: string | null;
  property_address: string;
  property_type: "single_family" | "multi_family" | "commercial" | "condo";
  property_sqft: number | null;
  property_stories: number | null;
  affected_areas: string | null;
  insurance_company: string | null;
  /** FK to a `contacts` row with role = 'insurance' (PRD #47). When set,
   *  the linked company's name is also snapshotted into `insurance_company`
   *  above so existing free-text readers stay untouched. */
  insurance_contact_id: string | null;
  /** FK to the `referral_partners` row that referred this Job (#298). Null
   *  when no Referral Partner is attributed; the read view in Job Info
   *  column 1 omits the line in that case. `ON DELETE SET NULL` clears it
   *  when a partner is permanently deleted (the soft-delete path keeps the
   *  FK pointing at the trashed row, by design). */
  referral_partner_id: string | null;
  claim_number: string | null;
  policy_number: string | null;
  payer_type: "insurance" | "homeowner" | "mixed" | null;
  date_of_loss: string | null;
  deductible: number | null;
  estimated_crew_labor_cost: number | null;
  hoa_name: string | null;
  hoa_contact_name: string | null;
  hoa_contact_phone: string | null;
  hoa_contact_email: string | null;
  access_notes: string | null;
  cover_photo_id: string | null;
  has_signed_contract?: boolean;
  has_pending_contract?: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  // Joined fields
  contact?: Contact;
  insurance_contact?: Contact | null;
  referral_partner?: { id: string; company_name: string } | null;
  job_adjusters?: JobAdjuster[];
  cover_photo?: Photo | null;
  // Tallied by the Comfortable-view loader (see attachJobCounts).
  photo_count?: number;
  file_count?: number;
}

export interface JobAdjuster {
  id: string;
  job_id: string;
  contact_id: string;
  is_primary: boolean;
  created_at: string;
  adjuster?: Contact;
}

export interface JobActivity {
  id: string;
  /** Owning Organization. NOT NULL in the DB and enforced by RLS. */
  organization_id: string;
  job_id: string;
  activity_type: "note" | "photo" | "milestone" | "insurance" | "equipment" | "expense";
  title: string;
  description: string | null;
  author: string;
  created_at: string;
}

export interface Invoice {
  id: string;
  organization_id: string;
  job_id: string;
  invoice_number: string;
  sequence_number: number;
  title: string;
  status: "draft" | "sent" | "partial" | "paid" | "voided";
  issued_date: string;
  due_date: string | null;
  opening_statement: string | null;
  closing_statement: string | null;
  subtotal: number;
  // #575 — invoices carry the same split Markup as estimates (#572): Overhead
  // + Profit, each applied to the raw subtotal. markup_amount is kept as their
  // sum so existing readers keep working; markup_type/markup_value stay
  // (NOT NULL, default none/0) but are write-dead.
  markup_type: "percent" | "amount" | "none";
  markup_value: number;
  markup_amount: number;
  overhead_type: "percent" | "amount" | "none";
  overhead_value: number;
  overhead_amount: number;
  profit_type: "percent" | "amount" | "none";
  profit_value: number;
  profit_amount: number;
  discount_type: "percent" | "amount" | "none";
  discount_value: number;
  discount_amount: number;
  adjusted_subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  po_number: string | null;
  memo: string | null;
  notes: string | null;
  converted_from_estimate_id: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  qb_invoice_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_sent_at: string | null;
  last_sent_to_email: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
  /** Per-document PDF layout snapshot; NULL = fall back to the org default preset (#482). */
  pdf_layout: DocumentPdfLayout | null;
}

export interface Payment {
  id: string;
  /** Owning Organization. NOT NULL in the DB and enforced by RLS. */
  organization_id: string;
  job_id: string;
  invoice_id: string | null;
  source: "insurance" | "homeowner" | "other";
  method: "check" | "ach" | "venmo_zelle" | "cash" | "credit_card";
  amount: number;
  reference_number: string | null;
  payer_name: string | null;
  status: "received" | "pending" | "due";
  notes: string | null;
  received_date: string | null;
  created_at: string;
}

export interface Photo {
  id: string;
  /** Owning Organization. NOT NULL in the DB and enforced by RLS. */
  organization_id: string;
  job_id: string;
  storage_path: string;
  annotated_path: string | null;
  caption: string | null;
  taken_at: string | null;
  taken_by: string;
  media_type: "photo" | "video";
  file_size: number | null;
  width: number | null;
  height: number | null;
  before_after_pair_id: string | null;
  before_after_role: "before" | "after" | null;
  created_at: string;
  /** Capture origin, e.g. "web" | "mobile" (free text in the DB; no CHECK). */
  uploaded_from: string;
  /** Mobile offline-capture idempotency key; null for web uploads. */
  client_capture_id: string | null;
  // Joined fields
  job?: Job;
  tags?: PhotoTag[];
}

export interface PhotoTag {
  id: string;
  /** Owning Organization. NOT NULL in the DB and enforced by RLS. */
  organization_id: string;
  name: string;
  color: string;
  created_by: string;
  created_at: string;
}

export interface PhotoTagAssignment {
  id: string;
  /** Owning Organization. NOT NULL in the DB and enforced by RLS. */
  organization_id: string;
  photo_id: string;
  tag_id: string;
  created_at: string;
  tag?: PhotoTag;
}

export interface PhotoAnnotation {
  id: string;
  /** Owning Organization. NOT NULL in the DB and enforced by RLS. */
  organization_id: string;
  photo_id: string;
  annotation_data: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PhotoReportTemplate {
  id: string;
  /** Owning Organization. NOT NULL in the DB and enforced by RLS. */
  organization_id: string;
  name: string;
  sections: unknown[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Photos per Photo Page for a report's Report Settings (ADR 0014, #549). The
 * legacy 1-per-page layout is dropped; reports/orgs previously on 1 fall back to
 * 2. Widened from the old 1|2|4 to 2|3|4 (a new 3-up Photo Page is added).
 */
export type ReportPhotosPerPage = 2 | 3 | 4;

export interface PhotoReport {
  id: string;
  /** Owning Organization. NOT NULL in the DB and enforced by RLS (#400). */
  organization_id: string;
  job_id: string;
  template_id: string | null;
  title: string;
  /** Per-Job report number ("Report #1, #2, ..."). Null until assigned (#400). */
  report_number: number | null;
  report_date: string;
  sections: unknown[];
  pdf_path: string | null;
  status: "draft" | "generated";
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Soft-delete timestamp for the recoverable trash (#402). Null = not deleted. */
  deleted_at: string | null;
  /**
   * Per-report snapshot of the Report Settings (photos-per-page + the six detail
   * toggles), seeded from the Organization default at creation (ADR 0014, #549).
   * Null on pre-0014 rows — read-tolerant, resolves to the Organization default.
   */
  report_settings: StoredReportSettingsJson | null;
  /**
   * Per-report Cover Page block visibility (logo/customer/property/contact/
   * insurance). Null on pre-0014 rows — read-tolerant, resolves to all-on.
   */
  cover_config: Partial<CoverBlockVisibility> | null;
  /**
   * The report's own cover photo (ADR 0014). Null falls back to the Job's cover
   * photo at resolve time. FK to `photos`, ON DELETE SET NULL.
   */
  cover_photo_id: string | null;
}

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface Email {
  id: string;
  account_id: string;
  job_id: string | null;
  message_id: string;
  thread_id: string | null;
  folder: "inbox" | "sent" | "drafts" | "trash" | "archive" | "spam" | "other";
  from_address: string;
  from_name: string | null;
  to_addresses: EmailAddress[];
  cc_addresses: EmailAddress[];
  bcc_addresses: EmailAddress[];
  subject: string;
  body_text: string | null;
  body_html: string | null;
  snippet: string | null;
  is_read: boolean;
  is_starred: boolean;
  has_attachments: boolean;
  matched_by: "contact" | "claim_number" | "address" | "job_id" | "manual" | null;
  category: "general" | "promotions" | "social" | "purchases" | null;
  uid: number | null;
  received_at: string;
  created_at: string;
  organization_id: string;
  // Joined fields
  job?: Job;
  account?: EmailAccount;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  id: string;
  email_id: string;
  filename: string;
  content_type: string | null;
  file_size: number | null;
  storage_path: string | null;
  created_at: string;
  organization_id: string;
}

export interface JobFile {
  id: string;
  job_id: string;
  filename: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string;
  created_at: string;
}

export interface EmailAccount {
  id: string;
  label: string;
  email_address: string;
  display_name: string;
  provider: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
  encrypted_password: string;
  signature: string | null;
  is_active: boolean;
  is_default: boolean;
  color: string | null;
  last_synced_at: string | null;
  last_synced_uid: number | null;
  created_at: string;
  updated_at: string;
  organization_id: string;
  /** Owner of a Personal account; null for a Shared account (migration-140). */
  user_id: string | null;
  /** One-time inbox-categorization backfill marker; null until it has run. */
  category_backfill_completed_at: string | null;
}

export interface JobStatus {
  id: string;
  name: string;
  display_label: string;
  bg_color: string;
  text_color: string;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface DamageType {
  id: string;
  name: string;
  display_label: string;
  bg_color: string;
  text_color: string;
  icon: string | null;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface FormFieldOption {
  value: string;
  label: string;
  /** Legacy: Tailwind class string used by the damage_types option-source path. New per-option colors set via the builder use bg_color + text_color (CSS color values applied as inline style). */
  color?: string;
  /** CSS color for the selected pill background (e.g. "#3b82f6"). */
  bg_color?: string;
  /** CSS color for the selected pill text (e.g. "#ffffff"). */
  text_color?: string;
}

export interface FormField {
  id: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "pill" | "checkbox" | "phone" | "email";
  label: string;
  placeholder?: string;
  required?: boolean;
  is_default?: boolean;
  visible?: boolean;
  maps_to?: string;
  default_value?: string;
  help_text?: string;
  options?: FormFieldOption[];
  options_source?: string;
  show_when?: string;
  merge_field_slug?: string;
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  is_default?: boolean;
  visible?: boolean;
  fields: FormField[];
}

export interface FormConfig {
  sections: FormSection[];
}

export interface FieldPreset {
  /** Unique key for the preset, e.g. "phone", "us_address" */
  key: string;
  /** Display label shown in the palette */
  name: string;
  /** Lucide icon name (kebab-case is fine; component import handled at usage site) */
  icon: string;
  /** One-line description shown on hover/expand */
  description: string;
  /** Builds the FormField that will be inserted when this preset is dragged in. Caller assigns the id. */
  makeField: () => Omit<FormField, "id">;
}

export interface JobCustomField {
  id: string;
  job_id: string;
  field_key: string;
  field_value: string | null;
  created_at: string;
}

// Jarvis

// An image or PDF attached to a Jarvis message (#198, #199). Stored inline
// in the conversation's `messages` JSONB — there is no `jarvis_attachments`
// table. `storage_path` points into the private `jarvis-attachments` bucket.
export interface JarvisAttachment {
  kind: "image" | "pdf";
  storage_path: string;
  media_type: string;
  filename?: string;
  // Anthropic Files API id — set for PDFs (#199). A PDF is uploaded to the
  // Files API once on attach and referenced by `file_id` on every replay,
  // so it is never re-encoded turn after turn.
  file_id?: string;
}

export interface JarvisMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  // Up to five Chat attachments per message (#200). #198 shipped a single
  // `attachment`; this list supersedes it. There is no production
  // conversation data, so the shape change carries no migration.
  attachments?: JarvisAttachment[];
}

export interface JarvisConversation {
  id: string;
  job_id: string | null;
  user_id: string | null;
  title: string | null;
  context_type: "general" | "job" | "rnd" | "marketing" | "field-ops";
  messages: JarvisMessage[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface JarvisAlert {
  id: string;
  job_id: string | null;
  user_id: string | null;
  message: string;
  priority: "low" | "medium" | "high";
  status: "active" | "resolved";
  due_date: string;
  created_at: string;
  resolved_at: string | null;
}

// Marketing
export interface MarketingAsset {
  id: string;
  file_name: string;
  storage_path: string;
  description: string | null;
  tags: string[];
  uploaded_by: string | null;
  created_at: string;
}

export interface MarketingDraft {
  id: string;
  platform: "instagram" | "facebook" | "linkedin" | "gbp";
  caption: string;
  hashtags: string | null;
  image_id: string | null;
  image_brief: string | null;
  status: "draft" | "ready" | "posted";
  conversation_id: string | null;
  posted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  image?: MarketingAsset;
}

/**
 * A Showcase — one public-facing story per Job (#613, PRD #603, ADR 0015): a
 * hand-picked, ordered set of that Job's Photos plus a title and write-up. At
 * most one LIVE Showcase per Job (the partial unique index in migration-613).
 * #613 is drafts-only; `published` is reserved for the later publishing slice.
 */
export interface Showcase {
  id: string;
  /** Owning Organization. NOT NULL in the DB and enforced by admin-only RLS. */
  organization_id: string;
  job_id: string;
  title: string;
  write_up: string;
  /** The Job's photo ids, in chosen gallery order (the order is meaningful). */
  photo_ids: string[];
  status: "draft" | "published";
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Soft-delete timestamp for the recoverable trash. Null = not deleted. */
  deleted_at: string | null;
  /**
   * Publish state (#606). The remote WordPress post this Showcase maps to —
   * recorded on first publish and reused on every re-push so an edit updates the
   * same post, never a duplicate. Null = never published.
   */
  wordpress_post_id: string | null;
  /** The live post URL (WordPress `link`), for the "View live post" link. */
  wordpress_post_url: string | null;
  /** When it was last successfully pushed live. Null = never published. */
  published_at: string | null;
  /** One-click photo-consent audit: who affirmed it, and when. Re-stamped on every publish. */
  consent_confirmed_by: string | null;
  consent_confirmed_at: string | null;
}

// Knowledge Base (RAG)
export interface KnowledgeDocument {
  id: string;
  name: string;
  file_name: string;
  standard_id: string;
  description: string | null;
  chunk_count: number;
  status: "processing" | "ready" | "error";
  file_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeChunk {
  id: string;
  document_id: string;
  content: string;
  section_number: string | null;
  section_title: string | null;
  page_number: number | null;
  chunk_index: number;
  token_count: number;
  created_at: string;
  // Joined / computed
  similarity?: number;
  document?: KnowledgeDocument;
}

export interface CompanySettings {
  company_name?: string;
  logo_path?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  license_number?: string;
  /** Company-wide photos-per-page for generated photo reports ("1" | "2" | "4"). */
  report_photos_per_page?: string;
}

export type VendorType =
  | "supplier"
  | "subcontractor"
  | "equipment_rental"
  | "fuel"
  | "other";

export interface Vendor {
  id: string;
  name: string;
  vendor_type: VendorType;
  default_category_id: string | null;
  is_1099: boolean;
  tax_id: string | null;
  notes: string | null;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  display_label: string;
  bg_color: string;
  text_color: string;
  icon: string | null;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type PaymentMethod =
  | "business_card"
  | "business_ach"
  | "cash"
  | "personal_reimburse"
  | "other";

export interface Expense {
  id: string;
  job_id: string;
  vendor_id: string | null;
  vendor_name: string;
  category_id: string;
  amount: number;
  expense_date: string;
  payment_method: PaymentMethod;
  description: string | null;
  receipt_path: string | null;
  thumbnail_path: string | null;
  submitted_by: string | null;
  submitter_name: string;
  activity_id: string | null;
  created_at: string;
  updated_at: string;
  // joined fields (present on GET responses that join)
  vendor?: Vendor | null;
  category?: ExpenseCategory | null;
}

export const EMAIL_PROVIDERS: Record<string, { label: string; imap_host: string; imap_port: number; smtp_host: string; smtp_port: number }> = {
  hostinger: { label: "Hostinger", imap_host: "imap.hostinger.com", imap_port: 993, smtp_host: "smtp.hostinger.com", smtp_port: 465 },
  network_solutions: { label: "Network Solutions", imap_host: "mail.aaacontracting.com", imap_port: 993, smtp_host: "smtp.aaacontracting.com", smtp_port: 587 },
  gmail: { label: "Gmail", imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 587 },
  outlook: { label: "Outlook / Microsoft 365", imap_host: "outlook.office365.com", imap_port: 993, smtp_host: "smtp.office365.com", smtp_port: 587 },
  custom: { label: "Custom", imap_host: "", imap_port: 993, smtp_host: "", smtp_port: 465 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Build 67a — Estimates & Invoices
// ─────────────────────────────────────────────────────────────────────────────

// #567 — the Estimate workflow is exactly draft → sent → converted / voided
// (ADR 0007). The retired `approved`/`rejected` states are gone; the
// `approved_at`/`rejected_at` columns below are kept nullable but never written.
export type EstimateStatus = 'draft' | 'sent' | 'converted' | 'voided';
export type AdjustmentType = 'percent' | 'amount' | 'none';
export type ItemCategory = 'labor' | 'equipment' | 'materials' | 'services' | 'other';

export interface Estimate {
  id: string;
  organization_id: string;
  job_id: string;
  estimate_number: string;
  sequence_number: number;
  title: string;
  status: EstimateStatus;
  opening_statement: string | null;
  closing_statement: string | null;
  subtotal: number;
  // #572 — the Markup is split into two independent uplifts, Overhead + Profit,
  // each applied to the raw subtotal. markup_amount is kept as their sum so
  // existing readers keep working; markup_type/markup_value stay (NOT NULL,
  // default none/0) but are write-dead — no longer the source of the Markup.
  markup_type: AdjustmentType;
  markup_value: number;
  markup_amount: number;
  overhead_type: AdjustmentType;
  overhead_value: number;
  overhead_amount: number;
  profit_type: AdjustmentType;
  profit_value: number;
  profit_amount: number;
  discount_type: AdjustmentType;
  discount_value: number;
  discount_amount: number;
  adjusted_subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  issued_date: string | null;
  valid_until: string | null;
  converted_to_invoice_id: string | null;
  converted_at: string | null;
  sent_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_sent_at: string | null;
  last_sent_to_email: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
  /** Per-document PDF layout snapshot; NULL = fall back to the org default preset (#482). */
  pdf_layout: DocumentPdfLayout | null;
}

export interface EstimateSection {
  id: string;
  organization_id: string;
  estimate_id: string;
  parent_section_id: string | null;
  title: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * How a line item is billed (issue #682).
 *
 * - `standard` — a single Quantity input; `total = quantity × unit_price`.
 * - `pieces_days` — equipment billed by Pieces × Days. The two inputs collapse
 *   into `quantity` (`quantity = pieces × days`), so the universal total
 *   formula and every downstream consumer stay equipment-ignorant. The pure
 *   reconcilers live in `components/estimate-builder/equipment-pricing.ts`.
 */
export type PricingMode = "standard" | "pieces_days";

export interface EstimateLineItem {
  id: string;
  organization_id: string;
  estimate_id: string;
  section_id: string;
  library_item_id: string | null;
  name: string | null;
  description: string;
  note: string | null;
  code: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  total: number;
  /** Billing mode for this row (issue #682). Defaults to `standard`. */
  pricing_mode: PricingMode;
  /** Equipment mode only: piece count. NULL in standard mode. */
  pieces: number | null;
  /** Equipment mode only: number of days. NULL in standard mode. */
  days: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ItemLibraryItem {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  code: string | null;
  category: ItemCategory;
  default_quantity: number;
  default_unit: string | null;
  unit_price: number;
  damage_type_tags: string[];
  section_tags: string[];
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Convenience: a fully-loaded estimate with nested sections + items.
export interface EstimateWithContents extends Estimate {
  sections: Array<EstimateSection & {
    items: EstimateLineItem[];
    subsections: Array<EstimateSection & { items: EstimateLineItem[] }>;
  }>;
}

export interface EstimateTemplate {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  damage_type_tags: string[];
  opening_statement: string | null;
  closing_statement: string | null;
  structure: TemplateStructure;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ─── PDF presets (Build 67c1) ──────────────────────────────────────────────

export type DocumentType = "estimate" | "invoice";

export interface PdfPreset {
  id: string;
  organization_id: string;
  name: string;
  document_type: DocumentType;
  document_title: string;
  show_markup: boolean;
  // #576 — Overhead & Profit visibility, parallel to the layout's toggles.
  // DB columns default false so existing presets keep their look.
  show_overhead: boolean;
  show_profit: boolean;
  show_discount: boolean;
  show_tax: boolean;
  show_opening_statement: boolean;
  show_closing_statement: boolean;
  show_category_subtotals: boolean;
  show_code_column: boolean;
  show_item_notes: boolean;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Subset accepted on POST (server fills the rest).
export type PdfPresetCreatePayload = Pick<
  PdfPreset,
  | "name" | "document_type" | "document_title"
  | "show_markup" | "show_overhead" | "show_profit" | "show_discount" | "show_tax"
  | "show_opening_statement" | "show_closing_statement"
  | "show_category_subtotals" | "show_code_column" | "show_item_notes"
  | "is_default"
>;

// All fields except `name` are optional on PUT (partial update).
export type PdfPresetUpdatePayload = Partial<Omit<PdfPreset,
  "id" | "organization_id" | "created_by" | "created_at" | "updated_at" | "document_type"
>>;

// ─── PDF layout (per-document snapshot) — #482 / ADR 0012 ──────────────────
//
// A document's *PDF layout* is a self-contained snapshot of the look it renders
// with — a snapshot, NOT a reference to a preset (ADR 0012). It carries the
// same eight toggles a PdfPreset does, plus `show_document_title`: the ninth
// toggle, new in #482 (today the title renders unconditionally). `show_item_notes`
// reuses #382's field name rather than adding a parallel flag.
//
// A NULL `pdf_layout` column means "no layout of its own; fall back to the
// Organization's default preset" — see `resolveEffectiveLayout` in pdf-layout.ts.
export interface DocumentPdfLayout {
  document_title: string;
  show_document_title: boolean;
  show_markup: boolean;
  // #576 — Overhead & Profit (the #572 markup split) get their own totals rows,
  // each behind its own toggle. Default HIDDEN, unlike every other toggle, so
  // documents that predate the toggles don't sprout two new lines.
  show_overhead: boolean;
  show_profit: boolean;
  show_discount: boolean;
  show_tax: boolean;
  show_opening_statement: boolean;
  show_closing_statement: boolean;
  show_category_subtotals: boolean;
  show_code_column: boolean;
  show_item_notes: boolean;
}

// =============================================================================
// 67b — invoices, templates, builder entity union
// =============================================================================

export interface InvoiceSection {
  id: string;
  organization_id: string;
  invoice_id: string;
  parent_section_id: string | null;
  title: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: string;
  organization_id: string;
  invoice_id: string;
  section_id: string | null;
  library_item_id: string | null;
  name: string | null;
  description: string;
  note: string | null;
  code: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  amount: number; // = total in estimate-land
  /** Billing mode for this row (issue #684). Defaults to `standard`. */
  pricing_mode: PricingMode;
  /** Equipment mode only: piece count. NULL in standard mode. */
  pieces: number | null;
  /** Equipment mode only: number of days. NULL in standard mode. */
  days: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceWithContents extends Invoice {
  sections: Array<InvoiceSection & {
    items: InvoiceLineItem[];
    subsections: Array<InvoiceSection & { items: InvoiceLineItem[] }>;
  }>;
}

export interface TemplateStructure {
  sections: Array<{
    title: string;
    sort_order: number;
    subsections?: Array<{
      title: string;
      sort_order: number;
      items?: TemplateStructureItem[];
    }>;
    items?: TemplateStructureItem[];
  }>;
}

/** Snapshot shape per ADR 0004. A template item stores its own name, code, unit,
 *  description, quantity, and unit_price; `library_item_id` is a soft breadcrumb.
 *  This is the only shape: the #352 backfill rewrote every legacy row into it and
 *  #353 dropped the transitional override fallback. */
export interface TemplateStructureItem {
  library_item_id: string | null;
  // Snapshot fields — written and read by all code.
  name?: string | null;
  description?: string | null;
  note?: string | null;
  code?: string | null;
  unit?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  /** Billing mode for this row (issue #684/#686). Absent ⇒ `standard`. */
  pricing_mode?: PricingMode | null;
  /** Equipment mode only: piece count. Absent/null in standard mode. */
  pieces?: number | null;
  /** Equipment mode only: number of days. Absent/null in standard mode. */
  days?: number | null;
  sort_order: number;
}

/** Templates use the builder shell, so they need a "with contents" projection too —
 *  but unlike estimates/invoices, the live builder state is what the editor edits;
 *  the `structure` JSONB column is materialized via the explicit Save Template button. */
export interface TemplateWithContents extends EstimateTemplate {
  // Mirror estimate shape so the builder shell renders a familiar tree.
  // Backed by transient estimate_templates_sections / _line_items? No — we use
  // the SAME estimate_sections / estimate_line_items tables but scoped via a
  // hidden "draft estimate" pattern. Implemented in Task 13.
  sections: Array<{
    id: string;
    title: string;
    sort_order: number;
    parent_section_id: string | null;
    items: Array<{
      id: string;
      library_item_id: string | null;
      name: string | null;
      description: string;
      note: string | null;
      code: string | null;
      quantity: number;
      unit: string | null;
      unit_price: number;
      pricing_mode?: PricingMode | null;
      pieces?: number | null;
      days?: number | null;
      sort_order: number;
    }>;
    subsections: Array<{
      id: string;
      title: string;
      sort_order: number;
      items: Array<{
        id: string;
        library_item_id: string | null;
        name: string | null;
        description: string;
        note: string | null;
        code: string | null;
        quantity: number;
        unit: string | null;
        unit_price: number;
        pricing_mode?: PricingMode | null;
        pieces?: number | null;
        days?: number | null;
        sort_order: number;
      }>;
    }>;
  }>;
}

// =============================================================================
// Builder entity discriminated union — used by the shared builder shell
// =============================================================================

export type BuilderEntity =
  | { kind: "estimate"; data: EstimateWithContents }
  | { kind: "invoice";  data: InvoiceWithContents }
  | { kind: "template"; data: TemplateWithContents };

export type BuilderMode = "estimate" | "invoice" | "template";

// =============================================================================
// Auto-save config — used by use-auto-save.ts
// =============================================================================

export interface AutoSaveConfig<T extends { id: string; updated_at?: string | null }> {
  entityKind: BuilderMode;
  entityId: string;
  paths: {
    rootPut: string;
    sectionsReorder: string;
    sectionRoute: (sectionId: string) => string;
    lineItemsReorder: string;
    lineItemRoute: (itemId: string) => string;
  };
  serializeRootPut: (entity: T) => unknown;
  hasSnapshotConcurrency: boolean;
}
