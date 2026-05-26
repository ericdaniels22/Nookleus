// Pure logic behind Call Worksheet edits (PRD #249, issue #253).
//
// `buildEditPayload` translates the raw body of a PATCH request — whatever
// the client sent — into the safe `update(...)` shape for the
// `referral_partners` row. It does two jobs and nothing else:
//
//   1. Whitelists the columns the Worksheet is allowed to edit (PRD #249's
//      editable list plus `status`). Anything outside the whitelist —
//      `id`, `organization_id`, `deleted_at`, the call-log denormalized
//      columns, the `*_contact_id` FKs — is dropped silently. The client
//      cannot write its way past these by guessing column names.
//
//   2. Normalizes per column: text fields are trimmed and collapsed to
//      `null` when blank (matching the New Target form pattern); `status`
//      is gated against the Lifecycle status enum; `company_name` must be
//      non-blank if present (the schema's only NOT-NULL business column).
//
// Pure and I/O-free so it can be exhaustively unit-tested, matching the
// `referral-partner-form` module from issue #250.

const LIFECYCLE_STATUSES = ["grey", "yellow", "green", "red"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

const EDITABLE_TEXT_COLUMNS = [
  "company_name",
  "industry",
  "lead_source",
  "operation_size",
  "office_phone",
  "office_email",
  "website",
  "address",
  "referral_fee_terms",
  "notes",
] as const;

type EditableTextColumn = (typeof EDITABLE_TEXT_COLUMNS)[number];

export interface EditPayload {
  company_name?: string;
  industry?: string | null;
  lead_source?: string | null;
  operation_size?: string | null;
  office_phone?: string | null;
  office_email?: string | null;
  website?: string | null;
  address?: string | null;
  referral_fee_terms?: string | null;
  notes?: string | null;
  status?: LifecycleStatus;
}

export type BuildEditResult =
  | { ok: true; payload: EditPayload }
  | { ok: false; error: string };

function nullable(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLifecycleStatus(v: unknown): v is LifecycleStatus {
  return (
    typeof v === "string" &&
    (LIFECYCLE_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Build the `update(...)` shape from a client body. Returns `{ ok: false }`
 * with a human-readable reason when the body is empty, the status is
 * unknown, or `company_name` is present-but-blank.
 */
export function buildEditPayload(raw: Record<string, unknown>): BuildEditResult {
  const payload: EditPayload = {};

  for (const column of EDITABLE_TEXT_COLUMNS) {
    if (!(column in raw)) continue;
    const normalized = nullable(raw[column]);
    if (column === "company_name") {
      if (normalized === null) {
        return { ok: false, error: "company_name cannot be blank" };
      }
      payload.company_name = normalized;
    } else {
      // Index by the union of optional keys so we don't have to switch on
      // each column name — TypeScript can't narrow the literal type back.
      (payload as Record<EditableTextColumn, string | null | undefined>)[
        column
      ] = normalized;
    }
  }

  if ("status" in raw) {
    if (!isLifecycleStatus(raw.status)) {
      return { ok: false, error: "Unknown Lifecycle status" };
    }
    payload.status = raw.status;
  }

  if (Object.keys(payload).length === 0) {
    return { ok: false, error: "No editable fields in body" };
  }

  return { ok: true, payload };
}
