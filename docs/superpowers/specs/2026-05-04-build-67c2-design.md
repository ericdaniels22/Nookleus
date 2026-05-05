---
title: Build 67c2 — Send Estimates & Invoices via Email
date: 2026-05-04
build_id: 67c2
parent_build: 67c
predecessor: 67c1
status: design — pending plan
---

# Build 67c2 — Design

Sub-build 2 of 2 inside Build 67c. Delivers the Send-via-email flow for estimates and invoices, layered on top of 67c1's PDF rendering. Reuses the existing `payment_email_settings` infrastructure for the org-shared sending identity.

## 1. Goals & non-goals

### Goals

- A user with `manage_estimates` (or `manage_invoices`) can send any non-voided, non-converted estimate (or non-voided invoice) to a recipient, with the chosen PDF preset attached, from the document's read-only view.
- The Send modal prefills recipient + subject + body from the job + org templates; the user can edit before sending.
- Each successful send writes an audit row to `contract_events` and stamps `sent_at` (first send only) + `last_sent_at` + `last_sent_to_email` on the document for one-line summary display.
- The org's outgoing-email identity (from-name, from-email, reply-to, provider) is shared with payment requests via the existing `payment_email_settings` row — one place to configure, three concerns served.
- Send failures (PDF render, provider error) leave the document state untouched and surface the error in the modal for the user to retry.

### Non-goals (deferred to later builds)

- **Per-user "from" override** — small additive follow-up; org-shared `from` only in v1.
- **Tiptap rich-text body composer** — plain `<Textarea>` v1; trivial future swap.
- **CC / BCC / multi-recipient To** — single recipient v1.
- **Send from builder pages or list views** — read-only view only in v1.
- **Send retry queue, bounce tracking, delivery webhooks** — fail loud, user retries from modal.
- **Scheduled or delayed sends** — immediate only.
- **Send from inside the AAA mobile app** — web-only entry point in v1; mobile follows the same API once the read-only views are wired in 65c+.
- **Live HTML preview of the resolved template inside the settings editor** — consistent with current `/settings/payment-emails`.
- **Estimate/invoice-specific merge tokens** (`{estimate_total}`, `{invoice_due_date}`, etc.) — only the standard customer/job/company merge fields from `buildMergeFieldValues` are wired in v1; document-specific extras are an additive follow-up.
- **Plain-text MIME multipart** — HTML-only emails (consistent with payments + contracts).
- **Standalone `mark-sent` route** — the send route handles the status transition atomically.

## 2. Decisions locked during brainstorm

| # | Decision | Choice |
|---|---|---|
| 1 | Settings table strategy | **B** — reuse `payment_email_settings`, add 4 template columns; rename UI page to "Outgoing Emails" (no table rename) |
| 2 | Send-history audit | **C** — stamp `last_sent_at` + `last_sent_to_email` on document row + append `contract_events` row per send |
| 3 | Modal composer richness | **A** — plain inputs; no Tiptap, no CC/BCC, single recipient |
| 4 | Permission keys | **B** — fold into existing `manage_estimates` / `manage_invoices`; no new permission keys |
| 5 | Send button surfaces | **A** — read-only view only |
| 6.1 | Pre-flight: from-email unconfigured | **A** — block at modal open with link to settings |
| 6.2 | Pre-flight: recipient missing | **A** — modal opens with empty `To`; manual entry accepted |
| 6.3 | Pre-flight: PDF render failure | **A** — block send; no email goes out without the attachment |
| 7 | Send-library duplication | Intentional v1 fresh implementation in `src/lib/email/send.ts`; existing `src/lib/payments/email.ts` + `src/lib/contracts/email.ts` left untouched. Consolidation queued as a separate cleanup chip. |

## 3. Status transition rules

### Estimates

| From | Action | Result |
|---|---|---|
| `draft` | Send succeeds | Status → `sent`; `sent_at` ← now; `last_sent_at` ← now; `last_sent_to_email` ← `<to>`; audit row written |
| `sent` | Send succeeds | Status unchanged; `sent_at` unchanged; `last_sent_at` ← now; `last_sent_to_email` ← `<to>`; audit row written |
| `approved` | Send succeeds | Same as `sent` row above (silent re-send) |
| `voided` | Send | 400 — "Cannot send a voided estimate"; UI button disabled with tooltip |
| `converted` | Send | 400 — "Cannot send a converted estimate"; UI button disabled with tooltip |

### Invoices

| From | Action | Result |
|---|---|---|
| `draft` | Send succeeds | Status → `sent`; `sent_at` ← now; `last_sent_at` ← now; `last_sent_to_email` ← `<to>`; audit row written; QB sync trigger fires |
| `sent`, `partially_paid`, `paid`, `overdue` | Send succeeds | Status unchanged; `sent_at` unchanged; `last_sent_at` ← now; `last_sent_to_email` ← `<to>`; audit row written; QB trigger does NOT re-fire (transition-watching trigger only fires on `draft → sent`) |
| `voided` | Send | 400 — "Cannot send a voided invoice"; UI button disabled with tooltip |

## 4. Deliverables

1. Migration `supabase/migration-build67c2-send-via-email.sql`:
   - 4 new columns on `payment_email_settings` (template strings).
   - 2 new columns on each of `estimates` and `invoices` (`last_sent_at`, `last_sent_to_email`).
   - Widen `contract_events.event_type` CHECK to include `estimate_sent` and `invoice_sent`.
   - Backfill the 4 new template columns on every existing `payment_email_settings` row with sensible defaults (Section 9).
2. TypeScript type updates in `src/lib/payments/types.ts` + the estimate/invoice type files.
3. New send module `src/lib/email/send.ts` with `sendOrgEmail(supabase, orgId, args)`. Loads `payment_email_settings` internally; dispatches Resend or SMTP via `email_accounts` (same shape as the existing payments + contracts implementations).
4. Helper `src/lib/email/html-to-text.ts` — converts the resolved HTML template body to plain text for the modal textarea, preserving newlines.
5. Helper `src/lib/email/template-resolver.ts` — wraps `buildMergeFieldValues` from contracts/merge-fields with no extras, returning `{ subject, html, unresolvedFields }` for estimate + invoice send.
6. New API route `POST /api/estimates/[id]/send`.
7. Replacement API route `POST /api/invoices/[id]/send` (existing stub deleted, rewritten with full send logic).
7a. New API route `GET /api/estimates/[id]/send/preview` — returns `{ subject, body_text, unresolvedFields }` resolved against the job + the org's estimate-send template. Body returned pre-converted to plain text for the modal textarea.
7b. New API route `GET /api/invoices/[id]/send/preview` — same shape, invoice-send template.
8. Updated org-create seed function so new orgs' `payment_email_settings` row is seeded with the 4 default templates populated.
9. Send modal `src/components/estimates/send-modal.tsx` — single component, mode-discriminated for estimate vs invoice.
10. Send-button wrapper `src/components/estimates/send-button.tsx` — owns the modal `open` state; mirrors the 67c1 `<ExportPdfButton>` pattern.
11. Send button wired into `/estimates/[id]` read-only client + `/invoices/[id]` read-only client, next to the existing Export button.
12. Settings UI updates at `/settings/payment-emails` (or current canonical route): page heading + nav label rename to "Outgoing Emails"; two new template-editor sections (Estimate send, Invoice send); accept-shape update on the existing PUT route.
13. §11 manual test pass (12 cases, Section 11).

### Out-of-scope explicitly

- Renaming `payment_email_settings` to `outgoing_email_settings` at the table level. (UI rename only; full table rename is part of the deferred consolidation chip.)
- Refactoring `src/lib/payments/email.ts` and `src/lib/contracts/email.ts` to share the new `src/lib/email/send.ts`.
- Changing the existing `payment_request` send flow.
- Altering `pdf_presets` or the renderer.
- Adding any new permission keys.

## 5. Data model

### 5a. `payment_email_settings` — add 4 columns

```sql
ALTER TABLE payment_email_settings
  ADD COLUMN estimate_send_subject_template text NOT NULL DEFAULT '',
  ADD COLUMN estimate_send_body_template    text NOT NULL DEFAULT '',
  ADD COLUMN invoice_send_subject_template  text NOT NULL DEFAULT '',
  ADD COLUMN invoice_send_body_template     text NOT NULL DEFAULT '';
```

After the ALTER, an UPDATE statement in the same migration sets the four columns to the defaults in Section 9 for every existing row.

The other columns (`id`, `send_from_email`, `send_from_name`, `reply_to_email`, `provider`, `email_account_id`, `payment_*_template`, `internal_notification_to_email`, etc.) are unchanged.

### 5b. `estimates` — add 2 columns

```sql
ALTER TABLE estimates
  ADD COLUMN last_sent_at      timestamptz,
  ADD COLUMN last_sent_to_email text;
```

Both NULL until first send. The existing `sent_at` column retains "first send" semantics (set once on `draft → sent`, never updated thereafter).

### 5c. `invoices` — add 2 columns

```sql
ALTER TABLE invoices
  ADD COLUMN last_sent_at      timestamptz,
  ADD COLUMN last_sent_to_email text;
```

Same semantics as estimates. The existing `invoices.sent_at` column retains "first sent" semantics.

### 5d. `contract_events` — widen `event_type` CHECK

The plan-write step reads the live CHECK definition from `pg_constraint` before drafting the migration so the existing values are preserved verbatim. The widened CHECK adds the two new values:

```sql
ALTER TABLE contract_events DROP CONSTRAINT contract_events_event_type_check;
ALTER TABLE contract_events ADD CONSTRAINT contract_events_event_type_check
  CHECK (event_type IN (
    -- existing values: 'created','sent','email_delivered','email_opened',
    -- 'link_viewed','reminder_sent','voided','expired','paid',
    -- 'payment_failed','refunded','partially_refunded','dispute_opened',
    -- 'dispute_closed' (full list re-read from pg_constraint at plan-write time)
    'estimate_sent',
    'invoice_sent'
  ));
```

The migration uses `BEGIN; ... COMMIT;` so the DROP + ADD pair is atomic. Lesson from 67c1 cleanup pass applies: the live constraint is re-read before writing the migration text, never reconstructed from memory.

### 5e. TypeScript type updates

- `src/lib/payments/types.ts:PaymentEmailSettings` — add the 4 new fields as `string` (NOT NULL DEFAULT '' on the schema means never null in TS).
- The estimate type (likely `lib/types.ts:Estimate` or `lib/estimates.ts`, plan-write confirms): add `last_sent_at: string | null` and `last_sent_to_email: string | null`.
- The invoice type (likely `lib/invoices.ts:InvoiceRow`): same two additions.

## 6. Send pipeline

### 6a. `src/lib/email/send.ts` (new)

Generic org-scoped send. Loads `payment_email_settings` internally, dispatches to Resend or SMTP based on the row's `provider` field. Implementation mirrors the existing `src/lib/payments/email.ts` + `src/lib/contracts/email.ts` shape but is a fresh, isolated copy — no shared state with those modules.

```ts
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

export async function sendOrgEmail(
  supabase: SupabaseClient,
  orgId: string,
  args: SendOrgEmailArgs,
): Promise<SendResult>;
```

`sendOrgEmail` is the only export the new API routes consume. It throws on configuration errors (`send_from_email` empty), provider errors (Resend rejection, SMTP failure), or missing email_account when `provider='email_account'`. The route catches and turns the throw into a redacted JSON error response.

The intentional duplication with the two existing send modules is documented in Section 7 and queued as a separate cleanup chip.

### 6b. `src/lib/email/html-to-text.ts` (new)

Small regex-based converter used by the modal to render the HTML template body in a plain `<Textarea>`:

- `<br>` (and variants) → `\n`
- `</p>` → `\n\n`
- All other tags stripped
- HTML entity decode for the common five (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`)

Not a full parser. Templates are well-formed and small; this matches the existing entity-decode in `src/lib/contracts/email-merge-fields.ts:48`.

### 6c. `src/lib/email/template-resolver.ts` (new)

Thin wrapper over `buildMergeFieldValues(supabase, jobId)` from `src/lib/contracts/merge-fields.ts`. Returns:

```ts
{ subject: string; html: string; unresolvedFields: string[] }
```

No extras layered on in v1 (no `{estimate_total}` etc.). Purpose: avoid importing from `contracts/` in non-contract estimate/invoice code paths, which would be a layering smell.

### 6d. Body content type

Templates stored in `payment_email_settings` are HTML (matches the existing payment_*_template convention).

**Open the modal:** the resolved HTML body is converted to plain text via `html-to-text.ts`. The textarea shows clean text — no raw `<p>` or `<br>` tags visible.

**On send:** the user's textarea content is wrapped back into HTML by the API route — HTML-escape special chars (`<`, `>`, `&`, `"`, `'`), then convert `\n\n` → `</p><p>` and `\n` → `<br>`, and finally wrap in `<p>...</p>`. The resulting HTML is what gets sent. This produces HTML emails consistent with the payments + contracts pipelines.

The subject is plain text both in the modal and on send (no escaping/wrapping).

## 7. Send-library duplication note

The `sendViaResend` and `sendViaSmtp` implementations in `src/lib/payments/email.ts` and `src/lib/contracts/email.ts` are ~90% identical. The new `src/lib/email/send.ts` is a third near-copy in v1. This is intentional:

- Touching the two existing modules during 67c2 risks regressions in payments and contracts (live, revenue-critical).
- The right consolidation is a focused refactor build (`outgoing_email_settings` table rename + extract `sendVia*` helpers + migrate two callers) — not a side-effect of feature work.
- Each individual copy stays small (~100 LoC), so the duplication cost is bounded.

The consolidation chip is filed in `00-NOW.md` Open threads as part of this build's handoff. Trigger conditions for picking it up: a 4th caller appearing, or a third independent settings table being added.

## 8. UI

### 8a. Send modal — `src/components/estimates/send-modal.tsx`

One component used for both estimate and invoice send.

```ts
type SendModalProps =
  | { open: boolean; onOpenChange: (o: boolean) => void;
      mode: "estimate"; estimateId: string; jobId: string; onSent?: () => void; }
  | { open: boolean; onOpenChange: (o: boolean) => void;
      mode: "invoice";  invoiceId:  string; jobId: string; onSent?: () => void; };
```

**On open** (three parallel fetches — `Promise.all` to minimize open-time latency):

1. `GET /api/{estimates|invoices}/[id]/send/preview` — returns `{ from_unconfigured, subject, body_text, unresolvedFields }`. If `from_unconfigured === true`, render the empty-state ("Configure your sending email first") with a link to `/settings/payment-emails` (or canonical Outgoing Emails route); Send button disabled and other fetches' results discarded. (Pre-flight 6.1 / Decision 6.1.) Otherwise prefill subject + body fields from the response. If `unresolvedFields.length > 0`, show a small inline warning chip listing the unresolved field names.
2. `GET /api/jobs/{jobId}/contact-email` (existing route) — prefills the recipient input.
3. `GET /api/pdf-presets?document_type={mode}` (existing route from 67c1 Export modal) — populates preset dropdown; default preset preselected.

**Modal contents (vertical stack):**

| Field | Component | Notes |
|---|---|---|
| To | `<Input>` | Single email; client-side regex validator `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` matching `PaymentRequestModal` |
| Subject | `<Input>` | Resolved template; user-editable |
| Body | `<Textarea>` (rows ≈ 10) | Resolved HTML converted to plain text; user-editable |
| Preset | `<Select>` | Same shape as Export modal; default preset preselected |
| (warning chip) | inline | Shown only if `unresolvedFields.length > 0` |
| Cancel + Send | footer buttons | Send disabled while submitting; spinner during render+upload+send |

**On Send click:**

1. Client-side validate `to` format. Reject with toast if invalid.
2. POST `/api/{estimates|invoices}/[id]/send` with `{ to, subject, body, preset_id }`. Body is the user's plain-text content; the route is responsible for the text→HTML wrap.
3. On 2xx → toast `Sent to {email}`, close modal, call `onSent()` (parent calls `router.refresh()`).
4. On 4xx/5xx → surface response error message in toast; modal stays open with edits preserved.

### 8b. Send button — `src/components/estimates/send-button.tsx`

Wrapper that owns the modal `open` state:

```ts
type SendButtonProps =
  | { mode: "estimate"; estimateId: string; jobId: string;
      status: EstimateStatus; canManage: boolean; onSent?: () => void; }
  | { mode: "invoice";  invoiceId:  string; jobId: string;
      status: InvoiceStatus;  canManage: boolean; onSent?: () => void; };
```

**Visibility**: Hidden when `!canManage` (UI defense-in-depth; server enforces via `requirePermission`).

**Disabled (with tooltip)** when:
- `mode === 'estimate'` and `status ∈ {voided, converted}` → tooltip "Cannot send a {voided|converted} estimate."
- `mode === 'invoice'` and `status === 'voided'` → tooltip "Cannot send a voided invoice."

Otherwise enabled. Click opens the modal.

### 8c. Read-only view wiring

- `/estimates/[id]` read-only client (e.g. `EstimateReadOnlyClient`): add `<SendButton mode="estimate" ...>` next to the existing `<ExportPdfButton>` in HeaderBar.
- `/invoices/[id]` read-only client (`InvoiceReadOnlyClient`): same treatment for invoice mode.

`canManage` derives from `useAuth().hasPermission('manage_estimates')` (or `manage_invoices`). `status` is passed from server-fetched data on the read-only page.

Builders, list views, and the job-page `<EstimatesInvoicesSection>` get **no** Send button in v1.

### 8d. Settings UI updates

The page at `/settings/payment-emails` (canonical route confirmed at plan-write time):

- **Heading**: "Payment Emails" → "Outgoing Emails".
- **Settings nav row label**: "Payment Emails" → "Outgoing Emails".
- **Top section copy**: existing description ("This 'from' address is used for payment-request emails…") updated to mention payment requests + estimate sends + invoice sends. From-email / from-name / reply-to / provider inputs unchanged.
- **Existing template editors**: kept as-is (payment_request, payment_reminder, payment_receipt, refund_confirmation, internal notifications).
- **New sections** added below the existing template editors:
  - "Estimate send — subject" (`<Input>` for `estimate_send_subject_template`).
  - "Estimate send — body" (HTML-aware editor matching the existing template editors' shape).
  - "Invoice send — subject".
  - "Invoice send — body".
- **PUT route accept-shape**: existing `PUT /api/settings/payment-emails` (canonical name confirmed at plan-write) accepts the four new fields. Validation: max length 5,000 chars per template; non-string rejected with 400.

The settings page is gated by the existing `manage_payment_emails` permission, unchanged.

## 9. Default templates

Seeded by the migration (UPDATE for existing rows) and by the org-create seed function (for future rows).

**Estimate subject default:**

```
Estimate from {company_name} — {job_address}
```

**Estimate body default:**

```html
<p>Hi {customer_first_name},</p>
<p>Attached is the estimate for the work at {job_address}. Please review and let us know if you have any questions.</p>
<p>Thanks,<br>{company_name}</p>
```

**Invoice subject default:**

```
Invoice from {company_name} — {job_address}
```

**Invoice body default:**

```html
<p>Hi {customer_first_name},</p>
<p>Attached is the invoice for the work at {job_address}. Payment instructions are in the attached PDF.</p>
<p>Thanks,<br>{company_name}</p>
```

All tokens used (`{company_name}`, `{customer_first_name}`, `{job_address}`) are present in the existing `buildMergeFieldValues` output. The plan-write step verifies this list against the live `merge-fields.ts` exports before locking the defaults.

If any of these fields don't have a value for a given job (e.g., the customer record has no first name), the resolved output leaves the token placeholder in place and `unresolvedFields` includes it — the modal warning chip alerts the user before send.

## 10. API routes

### 10a. `POST /api/estimates/[id]/send` (new)

**Request body:**

```ts
{ to: string; subject: string; body: string; preset_id: string }
```

**Steps:**

1. Auth (`createServerSupabaseClient`); 401 if no user.
2. Resolve `orgId` via `getActiveOrganizationId(supabase)`; 400 if missing.
3. `requirePermission('manage_estimates', orgId)`; 403 if denied.
4. Load estimate by `id`; 404 if missing or cross-org.
5. 400 if `status ∈ {voided, converted}`.
6. Validate `to` (server-side regex), `subject` non-empty, `body` non-empty, `preset_id` belongs to same org and `document_type='estimate'`. 400 on any failure.
7. Render PDF using the chosen preset — same code path as `POST /api/estimates/[id]/pdf`. Upload to Storage at the canonical scoped path with `upsert: true`. On render or upload failure: return 500 with redacted message via `apiDbError`. **No status change, no audit row, no `last_sent_*` stamp.**
8. Wrap user's `body` text → HTML (HTML-escape special chars, `\n\n` → `</p><p>`, `\n` → `<br>`, wrap in `<p>...</p>`).
9. Call `sendOrgEmail(supabase, orgId, { to, subject, html, attachments: [{ filename: '<estimate_number>.pdf', content: pdfBuffer, contentType: 'application/pdf' }] })`. On send failure: return 502 with redacted provider message; same no-stamp / no-audit semantics.
10. On send success, in a single transaction:
    - If status was `draft`: UPDATE status to `sent`, stamp `sent_at = now()`.
    - Always UPDATE `last_sent_at = now()`, `last_sent_to_email = <to>`.
    - INSERT `contract_events` row: `event_type='estimate_sent'`, `metadata={estimate_id, recipient: to, preset_id, message_id, provider}`, `organization_id = <orgId>`, `contract_id = NULL`, `signer_id = NULL`.
11. Return `{ ok: true, message_id, sent_at, last_sent_at, last_sent_to_email }` (200).

The route is wrapped with `apiDbError` for 5xx redaction (per 67a hardening sweep).

### 10b. `POST /api/invoices/[id]/send` (replace existing stub)

The current stub at `src/app/api/invoices/[id]/send/route.ts` is **deleted and rewritten**.

Same shape as the estimate route. Differences:

- Status check: 400 only when `status === 'voided'`.
- Permission: `manage_invoices`.
- Audit: `event_type='invoice_sent'`, `metadata={invoice_id, recipient: to, preset_id, message_id, provider}`.
- Status transition: `draft → sent` on first send fires the existing QB sync trigger automatically (transition-only trigger; re-sends from `sent`/`paid`/etc. don't re-fire it).

**Caller updates**: any existing callers of the old stub get rewritten to pass the new body shape `{ to, subject, body, preset_id }`. The plan-write step greps for callers — likely the only one (if any) is a previous Send button stub on the invoice read-only page that the new modal replaces.

### 10c. Send-preview routes (new)

**`GET /api/estimates/[id]/send/preview`**

1. Auth + `requirePermission('manage_estimates', orgId)`. 401/403 on failure.
2. Load estimate + verify org match. 404 if missing or cross-org.
3. Load `payment_email_settings.estimate_send_subject_template` + `estimate_send_body_template` for the org. If `payment_email_settings.send_from_email` is empty, return `{ from_unconfigured: true }` with 200 — modal renders the empty-state from this signal.
4. Resolve the template via `template-resolver.ts` against `estimate.job_id`. Convert resolved HTML body to plain text via `html-to-text.ts`.
5. Return `{ from_unconfigured: false, subject, body_text, unresolvedFields }` (200).

**`GET /api/invoices/[id]/send/preview`** — same shape, `manage_invoices` permission, invoice-send templates, `invoice.job_id` for resolution.

Status-based blocks (voided / converted) do NOT block the preview route — the modal needs to be able to open and read the templates even on a doc that can't be sent. The Send button in the read-only view is the single point of UI gating; the preview route just answers "what would this email look like."

### 10d. Settings PUT route

Existing `PUT /api/settings/payment-emails` (canonical name confirmed at plan-write):

- Accept-shape extended with the four new template fields.
- Validation: each template ≤ 5,000 chars, must be a string. Otherwise 400.
- Permission: existing `manage_payment_emails` gate, unchanged.

No new route, no new permission, no new file.

### 10e. Org-create seed update

Wherever `payment_email_settings` rows are seeded for new orgs (likely a SQL function + a TypeScript helper — plan-write confirms exact location), update to include the four template defaults from Section 9. Existing orgs handled by the migration UPDATE.

## 11. Manual test plan (§11-style)

| # | Scenario | Pass criterion |
|---|---|---|
| 1 | Send estimate from `draft` to a valid recipient | Email arrives with PDF attached; estimate status now `sent`; `sent_at` + `last_sent_at` + `last_sent_to_email` stamped; `contract_events` row present with `event_type='estimate_sent'` |
| 2 | Re-send same estimate to a different recipient | `last_sent_to_email` updated; `last_sent_at` updated; `sent_at` unchanged; status unchanged; new `contract_events` row |
| 3 | Send estimate from `voided` (manually set in DB) | Send button disabled in UI with tooltip; direct API call returns 400 |
| 4 | Send estimate from `converted` | Same as 3 |
| 5 | Send invoice from `draft` | Email arrives with PDF; invoice now `sent`; QB sync trigger fires (verify `quickbooks_sync_status='pending'` if QB connected, or `not_applicable` if not); `last_sent_*` stamped; audit row written |
| 6 | Re-send invoice from `paid` | Audit row written; status + `paid_at` unchanged; QB trigger does NOT fire again (verify `quickbooks_sync_attempted_at` unchanged) |
| 7 | Open Send modal when `payment_email_settings.send_from_email` is empty | Empty-state with link to settings; Send button disabled; no API call attempted |
| 8 | Open Send modal for a job with no contact email | `to` field empty; manual entry of a valid email accepted; send completes |
| 9 | Open Send modal as a user without `manage_estimates` (SQL role flip per 67c1's pattern) | Send button hidden in read-only view; direct API call returns 403 |
| 10 | Edit subject + body in modal then send | Email arrives with edited content (not the template default); audit `metadata.recipient` matches the entered To address |
| 11 | Send when PDF render fails (force a render error, e.g., DB row corruption or simulated render exception) | Toast surfaces redacted error; modal stays open with user edits preserved; document NOT transitioned; no `last_sent_*` stamps; no audit row |
| 12 | Send when Resend returns an error (force via test API key or invalid recipient domain that Resend rejects) | Toast surfaces redacted provider error; modal open; no state mutations |

## 12. Sequencing (rough plan shape)

The implementation plan (`docs/superpowers/plans/2026-05-04-build-67c2-send-via-email.md`, written next) groups the work into ~12-15 SDD tasks:

1. **Migration + types** — schema deltas + TS interface updates.
2. **Send pipeline** — `src/lib/email/send.ts`, `html-to-text.ts`, `template-resolver.ts`.
3. **Estimate send API route** — `POST /api/estimates/[id]/send`.
4. **Invoice send API route** — replacement for the stub.
5. **Settings UI rename + new template editors** — page heading, nav label, two new editor sections.
6. **Settings PUT accept-shape update** — 4 new fields + validation.
7. **Send modal** — `src/components/estimates/send-modal.tsx`.
8. **Send button wrapper** — `src/components/estimates/send-button.tsx`.
9. **Wire send button into estimate read-only view**.
10. **Wire send button into invoice read-only view**.
11. **Org-create seed update for default templates**.
12. **§11 manual test pass** — 12 cases above.

The plan-write step expands these into ordered tasks with file paths, verification commands, and dispatch ordering.

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Existing `payment_email_settings` row missing for some org (table is presumed seeded for every org but not formally audited) | Plan-write task does a SQL audit before the migration runs; if any org is missing a row, the migration backfills via INSERT before the UPDATE. |
| `contract_events` CHECK constraint contents differ from what's documented | Live re-read from `pg_constraint` at plan-write time; the migration text is generated from the live values, not reconstructed. |
| Resend recipient-domain rejection during testing | Test plan #12 explicitly covers this. The route returns 502 with a redacted message; the modal stays open. |
| QB sync trigger fires on a re-send | The trigger is defined to watch the `draft → sent` transition only (Build 16d / 17). Re-sends update other columns but not status, so no re-fire. Test #6 verifies. |
| HTML escaping the user body misses an edge case (e.g., user pastes raw HTML) | Plain-text-in / HTML-out is by design: anything the user types in the textarea is treated as text and escaped, including any HTML they paste. This is safer than parsing pasted HTML. Documented behavior. |
| Settings page rename misses a code reference | Plan-write greps for "Payment Emails" / "payment-emails" across `src/app` and `src/components` to identify all references. The DB table name is unchanged so no SQL refs need updating. |

## 14. Links

- Predecessor: [[build-67c1]] — PDF Presets, Rendering, Export
- Predecessor handoff: [[2026-05-04-build-67c1-4]] — cleanup pass, queues 67c2
- Existing email infra: `src/lib/payments/email.ts`, `src/lib/contracts/email.ts`, `src/lib/contracts/email-merge-fields.ts`, `src/lib/contracts/merge-fields.ts`
- Existing modal pattern: `src/components/payments/payment-request-modal.tsx`
- 67c1 Export modal pattern: `src/components/estimates/export-pdf-modal.tsx` (canonical name confirmed at plan-write)
- Plan: `docs/superpowers/plans/2026-05-04-build-67c2-send-via-email.md` (to be written next)
