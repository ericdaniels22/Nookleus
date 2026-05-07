export type MergeFieldCategory =
  | "Customer"
  | "Property"
  | "Job"
  | "Insurance"
  | "Company";

export interface MergeFieldDefinition {
  name: string;
  label: string;
  category: MergeFieldCategory;
  description?: string;
}

export type OverlayFieldType =
  | "merge"
  | "signature"
  | "date"
  | "label"
  | "input"
  | "checkbox";

export interface OverlayField {
  id: string;            // uuid v4
  type: OverlayFieldType;
  page: number;          // 1-indexed
  x: number;             // PDF points from page top-left
  y: number;             // PDF points from page top-left
  width: number;         // PDF points
  height: number;        // PDF points
  fontSize: number;      // points; default 11
  // Type-specific (all optional in the shape; required by type per validation):
  mergeFieldName?: string;
  labelText?: string;
  signerOrder?: 1 | 2;   // matches contract_signers.signer_order
  inputKey?: string;
  inputLabel?: string;
  required?: boolean;
}

export interface PdfPage {
  page: number;
  width_pt: number;
  height_pt: number;
}

export interface ContractTemplate {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  pdf_storage_path: string | null;
  pdf_page_count: number | null;
  pdf_pages: PdfPage[] | null;
  overlay_fields: OverlayField[];
  signer_count: 1 | 2;
  signer_role_label: string;
  is_active: boolean;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractTemplateListItem {
  id: string;
  name: string;
  description: string | null;
  pdf_page_count: number | null;
  signer_count: 1 | 2;
  is_active: boolean;
  updated_at: string;
}

export interface ResolvedPreviewResponse {
  html: string;
  unresolvedFields: string[];
}

// ---------- Build 15b: contracts ----------

export type ContractStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "signed"
  | "voided"
  | "expired";

export type ContractEventType =
  | "created"
  | "sent"
  | "email_delivered"
  | "email_opened"
  | "link_viewed"
  | "signed"
  | "reminder_sent"
  | "voided"
  | "expired";

export type ContractEmailProvider = "resend" | "email_account";

export interface Contract {
  id: string;
  organization_id: string;
  job_id: string;
  template_id: string;
  template_version: number;
  title: string;
  status: ContractStatus;
  filled_content_html: string;
  filled_content_hash: string;
  signed_pdf_path: string | null;
  customer_inputs: Record<string, string | boolean> | null;
  link_token: string | null;
  link_expires_at: string | null;
  sent_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  signed_at: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  reminder_count: number;
  next_reminder_at: string | null;
  sent_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractSigner {
  id: string;
  organization_id: string;
  contract_id: string;
  signer_order: 1 | 2;
  role_label: string | null;
  name: string;
  email: string;
  phone: string | null;
  signature_image_path: string | null;
  typed_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  esign_consent_at: string | null;
  signed_at: string | null;
  created_at: string;
}

export interface ContractEvent {
  id: string;
  contract_id: string;
  signer_id: string | null;
  event_type: ContractEventType;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ContractEmailSettings {
  id: string;
  send_from_email: string;
  send_from_name: string;
  reply_to_email: string | null;
  provider: ContractEmailProvider;
  email_account_id: string | null;
  signing_request_subject_template: string;
  signing_request_body_template: string;
  signed_confirmation_subject_template: string;
  signed_confirmation_body_template: string;
  signed_confirmation_internal_subject_template: string;
  signed_confirmation_internal_body_template: string;
  reminder_subject_template: string;
  reminder_body_template: string;
  reminder_day_offsets: number[];
  default_link_expiry_days: number;
  updated_at: string;
}

// Per-signer slice surfaced on list rows so the Contracts section on the
// job detail tab can render sequential status for multi-signer contracts.
export interface ContractListSigner {
  id: string;
  signer_order: number;
  name: string | null;
  role_label: string | null;
  signed_at: string | null;
}

// Row shape returned by /api/contracts/by-job for the Contracts section
// on the job-detail Overview tab.
export interface ContractListItem {
  id: string;
  title: string;
  status: ContractStatus;
  sent_at: string | null;
  first_viewed_at: string | null;
  signed_at: string | null;
  link_expires_at: string | null;
  void_reason: string | null;
  signed_pdf_path: string | null;
  primary_signer_name: string | null;
  primary_signer_ip: string | null;
  signer_count: number;
  signers: ContractListSigner[];
  reminder_count: number;
  next_reminder_at: string | null;
  created_at: string;
}

// JWT payload encoded into the signing link. Stored server-side by a
// pre-computed pair of UUIDs so verifySigningToken can confirm the token
// still matches the contract row it was issued for.
export interface SigningTokenPayload {
  contract_id: string;
  signer_id: string;
  iat: number;
  exp: number;
}

// Signer-order-N view returned by GET /api/sign/[token] to render the
// public signing page. Strips fields the customer doesn't need to see.
export interface PublicSigningView {
  contract: {
    id: string;
    title: string;
    status: ContractStatus;
    link_expires_at: string | null;
    signed_at: string | null;
    signed_pdf_path: string | null;
    // Legacy: only populated for contracts authored before build 15d.
    legacy_html: string | null;
  };
  template: {
    id: string;
    pdf_url: string | null;          // signed URL of source template PDF
    pdf_pages: PdfPage[] | null;
    overlay_fields: OverlayField[];
    signer_count: 1 | 2;
    signer_role_label: string;
  };
  resolved_merge_values: Record<string, string>;
  signer: {
    id: string;
    signer_order: 1 | 2;
    name: string;
    role_label: string | null;
    signed_at: string | null;
  };
  other_signers: {
    id: string;
    signer_order: 1 | 2;
    signed_at: string | null;
  }[];
  company: {
    name: string;
    phone: string;
    email: string;
    address: string;
    logo_url: string | null;
  };
}
