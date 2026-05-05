# Build 67c2 — Send Estimates & Invoices via Email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Send-via-email flow on estimate and invoice read-only views that attaches the chosen PDF preset, reusing `payment_email_settings` for the org-shared sending identity.

**Architecture:** New shared send module `src/lib/email/send.ts` reads `payment_email_settings` and dispatches Resend or SMTP. Two new POST send routes + two new GET preview routes. Schema deltas: 4 template columns on `payment_email_settings`, `last_sent_at` + `last_sent_to_email` on `estimates` and `invoices`, widened `contract_events.event_type` CHECK. Modal component shared between estimate and invoice modes; Send button wrapper imported into the estimate server page and the invoice read-only client.

**Tech Stack:** Next.js 15.5 (App Router), TypeScript, Supabase (Postgres + RLS), Resend, nodemailer, React 19, shadcn/ui, sonner, `@react-pdf/renderer` (existing 67c1 renderer reused).

**Spec:** [docs/superpowers/specs/2026-05-04-build-67c2-design.md](../specs/2026-05-04-build-67c2-design.md)

---

## Spec corrections (verified during plan-write 2026-05-04)

The brainstorm spec referenced a few paths and identifiers that differ from the live codebase. These corrections apply across all tasks:

| Spec said | Actual (verified) |
|---|---|
| Settings UI route `/settings/payment-emails` | `/settings/payments` (file: `src/app/settings/payments/page.tsx`) |
| Permission `manage_payment_emails` | `access_settings` (existing gate on the PATCH route) |
| `PUT /api/settings/payment-emails` | `PATCH /api/settings/payment-email` (singular) |
| `requirePermission('manage_estimates', orgId)` (two-arg) | `requirePermission(supabase, 'manage_estimates')` (orgId sourced internally via `getActiveOrganizationId`) |
| Invoice status `partially_paid` | `partial` |
| Invoice status `overdue` | (does not exist; drop from re-send list) |
| `/api/invoices/[id]/send` is the only stub | Two stubs exist: `/api/invoices/[id]/send` (rewritten by this build) and `/api/invoices/[id]/mark-sent` (left alone — different concern: marks sent without emailing, used when delivery happens outside the platform) |

**Estimate `rejected` status:** the spec did not list this status (added in 67a). Treat as a silent re-send target — same as `sent`/`approved`: `last_sent_*` updated, status unchanged, audit row written.

---

## Pre-flight verification

Before Task 1, run these queries via Supabase MCP `execute_sql` to lock in exact values the migration depends on:

1. **Capture existing `contract_events.event_type` CHECK definition verbatim:**
   ```sql
   SELECT pg_get_constraintdef(oid)
     FROM pg_constraint
    WHERE conname = 'contract_events_event_type_check';
   ```
   Paste the result into a scratch note — Task 1's migration drops + re-adds this constraint and must include all existing values.

2. **Verify every org has a `payment_email_settings` row:**
   ```sql
   SELECT o.id AS org_id, o.name AS org_name, pes.id AS settings_id, pes.send_from_email
     FROM organizations o
     LEFT JOIN payment_email_settings pes ON pes.organization_id = o.id
    ORDER BY o.name;
   ```
   If any row has `settings_id IS NULL`, Task 1's migration must `INSERT` defaults for that org before the `UPDATE` step.

3. **Verify expected columns absent / present:**
   ```sql
   SELECT table_name, column_name
     FROM information_schema.columns
    WHERE table_name IN ('estimates','invoices','payment_email_settings')
      AND column_name IN (
        'sent_at',
        'last_sent_at',
        'last_sent_to_email',
        'estimate_send_subject_template',
        'estimate_send_body_template',
        'invoice_send_subject_template',
        'invoice_send_body_template'
      )
    ORDER BY table_name, column_name;
   ```
   Expected: `estimates.sent_at` exists; `invoices.sent_at` exists. Everything else returns 0 rows.

If any of the above contradicts the assumption, stop and adjust the plan before proceeding.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `supabase/migration-build67c2-send-via-email.sql` | Schema deltas (Section 5 of spec) + default-template backfill |
| `src/lib/email/send.ts` | `sendOrgEmail(supabase, orgId, args)` — loads `payment_email_settings`, dispatches Resend or SMTP |
| `src/lib/email/html-to-text.ts` | Convert resolved-template HTML body to plain text for the modal textarea |
| `src/lib/email/template-resolver.ts` | Wrap `buildMergeFieldValues` from contracts; return `{ subject, html, unresolvedFields }` |
| `src/lib/email/text-to-html.ts` | Convert user-edited plain-text body back to HTML for sending (escape + `\n` → `<br>` + paragraph wrap) |
| `src/app/api/estimates/[id]/send/route.ts` | `POST` send handler |
| `src/app/api/estimates/[id]/send/preview/route.ts` | `GET` modal preview handler |
| `src/app/api/invoices/[id]/send/preview/route.ts` | `GET` modal preview handler |
| `src/components/send-modal/index.tsx` | Modal component, mode-discriminated for estimate vs invoice |
| `src/components/send-modal/button.tsx` | Button wrapper that owns modal `open` state; mirrors `<ExportPdfButton>` |
| `docs/superpowers/specs/2026-05-04-build-67c2-test-results.md` | §11 test pass results doc |

### Modified files

| Path | Change |
|---|---|
| `src/lib/payments/types.ts` | Add 4 template fields to `PaymentEmailSettings` |
| `src/lib/types.ts` | Add `last_sent_at: string \| null`, `last_sent_to_email: string \| null` to `Estimate` and `Invoice` |
| `src/app/api/invoices/[id]/send/route.ts` | Replace stub with full send logic |
| `src/app/api/settings/payment-email/route.ts` | Add 4 template fields to PATCH `stringFields` array |
| `src/app/settings/payments/page.tsx` | Heading rename "Payment Emails" → "Outgoing Emails"; add 4 new `<PaymentEmailTemplateField>` blocks |
| `src/lib/settings-nav.ts` | Line 52 label "Payment Emails" → "Outgoing Emails" |
| `src/app/estimates/[id]/page.tsx` | Add `<SendButton mode="estimate" …>` next to `<ExportPdfButton>` |
| `src/components/invoices/invoice-read-only-client.tsx` | Replace existing inline `<button onClick={handleSend}>Send</button>` + `handleSend` function with `<SendButton mode="invoice" …>` |

---

## Notes on TDD adaptation

This repo has **no test framework** (no jest/vitest/playwright per the project memory). "Tests" = `npx tsc --noEmit` + `npm run build` for code-correctness, and a manual §11 pass for feature-correctness. Each task's verification step is `npx tsc --noEmit` + (where appropriate) a curl probe against the dev server or a Supabase MCP `execute_sql` check. The final manual test pass (Task 16) is the feature gate.

---

## Task 1: Migration + types

**Files:**
- Create: `supabase/migration-build67c2-send-via-email.sql`
- Modify: `src/lib/payments/types.ts`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Capture the existing `contract_events.event_type` CHECK constraint values**

Use Supabase MCP `execute_sql` (or psql) and run:

```sql
SELECT pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname = 'contract_events_event_type_check';
```

Copy the full `CHECK ((event_type = ANY (ARRAY[...])))` body into a scratch note. The list will look something like:

```
'created','sent','email_delivered','email_opened','link_viewed','reminder_sent',
'voided','expired','paid','payment_failed','refunded','partially_refunded',
'dispute_opened','dispute_closed'
```

The migration in Step 3 must include every existing value plus the two new ones; do not reconstruct from memory.

- [ ] **Step 2: Verify every org has a `payment_email_settings` row**

```sql
SELECT o.id AS org_id, o.name AS org_name, pes.id AS settings_id, pes.send_from_email
  FROM organizations o
  LEFT JOIN payment_email_settings pes ON pes.organization_id = o.id
 ORDER BY o.name;
```

If any row has `settings_id IS NULL`, note the org IDs — Step 3's migration includes a `WITH ... INSERT` block that seeds defaults for missing orgs before the `UPDATE` step.

- [ ] **Step 3: Write the migration file**

Create `supabase/migration-build67c2-send-via-email.sql`:

```sql
-- ============================================================================
-- Build 67c2 — Send Estimates & Invoices via Email
-- Schema deltas:
--   - 4 template columns on payment_email_settings (NOT NULL DEFAULT '')
--   - last_sent_at + last_sent_to_email on estimates + invoices
--   - widen contract_events.event_type CHECK to include estimate_sent / invoice_sent
--   - backfill default templates on every existing payment_email_settings row
--   - INSERT default rows for any org missing one (defensive)
--   - AFTER INSERT trigger on organizations: seed payment_email_settings
--     for any future-created org (mirrors 67c1's seed_default_pdf_presets)
-- ============================================================================

BEGIN;

-- 1. payment_email_settings: 4 new template columns
ALTER TABLE payment_email_settings
  ADD COLUMN estimate_send_subject_template text NOT NULL DEFAULT '',
  ADD COLUMN estimate_send_body_template    text NOT NULL DEFAULT '',
  ADD COLUMN invoice_send_subject_template  text NOT NULL DEFAULT '',
  ADD COLUMN invoice_send_body_template     text NOT NULL DEFAULT '';

-- 2. Defensive: insert payment_email_settings rows for any org missing one.
-- 18a/18b made organization_id NOT NULL; if any org slipped through this fills.
INSERT INTO payment_email_settings (organization_id, send_from_email, send_from_name, provider)
SELECT o.id, '', 'Outgoing', 'resend'
  FROM organizations o
 WHERE NOT EXISTS (
   SELECT 1 FROM payment_email_settings pes WHERE pes.organization_id = o.id
 );

-- 3. Backfill the 4 new template columns on every row with sensible defaults.
UPDATE payment_email_settings SET
  estimate_send_subject_template = 'Estimate from {company_name} — {job_address}',
  estimate_send_body_template = E'<p>Hi {customer_first_name},</p>\n<p>Attached is the estimate for the work at {job_address}. Please review and let us know if you have any questions.</p>\n<p>Thanks,<br>{company_name}</p>',
  invoice_send_subject_template = 'Invoice from {company_name} — {job_address}',
  invoice_send_body_template = E'<p>Hi {customer_first_name},</p>\n<p>Attached is the invoice for the work at {job_address}. Payment instructions are in the attached PDF.</p>\n<p>Thanks,<br>{company_name}</p>'
WHERE estimate_send_subject_template = '';

-- 4. estimates: last_sent_at + last_sent_to_email
ALTER TABLE estimates
  ADD COLUMN last_sent_at      timestamptz,
  ADD COLUMN last_sent_to_email text;

-- 5. invoices: last_sent_at + last_sent_to_email
ALTER TABLE invoices
  ADD COLUMN last_sent_at      timestamptz,
  ADD COLUMN last_sent_to_email text;

-- 6. Widen contract_events.event_type CHECK.
-- IMPORTANT: replace the values list below with the verbatim list captured
-- from Step 1's pg_get_constraintdef query, with 'estimate_sent' and
-- 'invoice_sent' appended. Do not reconstruct from memory.
ALTER TABLE contract_events DROP CONSTRAINT contract_events_event_type_check;
ALTER TABLE contract_events ADD CONSTRAINT contract_events_event_type_check
  CHECK (event_type IN (
    'created','sent','email_delivered','email_opened','link_viewed',
    'reminder_sent','voided','expired','paid','payment_failed',
    'refunded','partially_refunded','dispute_opened','dispute_closed',
    'estimate_sent','invoice_sent'
  ));

-- 7. AFTER INSERT trigger on organizations: seed payment_email_settings
-- for any future org. Mirrors the 67c1 seed_default_pdf_presets pattern.
-- Defensive WHERE NOT EXISTS guard belt-and-suspenders against re-fire.
CREATE OR REPLACE FUNCTION public.seed_default_payment_email_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO payment_email_settings (
    organization_id,
    send_from_email,
    send_from_name,
    provider,
    estimate_send_subject_template,
    estimate_send_body_template,
    invoice_send_subject_template,
    invoice_send_body_template
  )
  SELECT
    NEW.id,
    '',
    'Outgoing',
    'resend',
    'Estimate from {company_name} — {job_address}',
    E'<p>Hi {customer_first_name},</p>\n<p>Attached is the estimate for the work at {job_address}. Please review and let us know if you have any questions.</p>\n<p>Thanks,<br>{company_name}</p>',
    'Invoice from {company_name} — {job_address}',
    E'<p>Hi {customer_first_name},</p>\n<p>Attached is the invoice for the work at {job_address}. Payment instructions are in the attached PDF.</p>\n<p>Thanks,<br>{company_name}</p>'
  WHERE NOT EXISTS (
    SELECT 1 FROM payment_email_settings WHERE organization_id = NEW.id
  );
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_seed_default_payment_email_settings
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION seed_default_payment_email_settings();

COMMIT;
```

**Important:** the values inside the final CHECK MUST match Step 1's captured list verbatim. The example above is the expected list, but if `pg_get_constraintdef` returns anything different (e.g., a value was added by a build between this plan's drafting and execution), use the live list.

- [ ] **Step 4: Apply the migration via Supabase MCP**

Use `mcp__31d06679-0873-477e-9c25-9bf1da0b041e__apply_migration` with name `build67c2_send_via_email` and the SQL body from Step 3.

- [ ] **Step 5: Verify the migration applied cleanly**

Run via `execute_sql`:

```sql
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE (table_name = 'payment_email_settings' AND column_name LIKE '%_send_%_template')
    OR (table_name IN ('estimates','invoices') AND column_name IN ('last_sent_at','last_sent_to_email'))
 ORDER BY table_name, column_name;
```

Expected: 8 rows (4 template columns + 2 estimate columns + 2 invoice columns).

```sql
SELECT pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname = 'contract_events_event_type_check';
```

Expected: the new CHECK definition includes `'estimate_sent'` and `'invoice_sent'`.

```sql
SELECT organization_id, estimate_send_subject_template, invoice_send_subject_template
  FROM payment_email_settings
 ORDER BY organization_id;
```

Expected: every row has `Estimate from {company_name} — {job_address}` and `Invoice from {company_name} — {job_address}` (both non-empty).

```sql
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgname = 'trg_seed_default_payment_email_settings';
```

Expected: 1 row, `tgenabled = 'O'` (enabled, origin).

- [ ] **Step 6: Update `src/lib/payments/types.ts`**

Open `src/lib/payments/types.ts`. Add the four new fields to the `PaymentEmailSettings` interface (after the existing `internal_notification_to_email` field, before the closing brace):

```ts
  // Added in build67c2 — estimate + invoice send templates
  estimate_send_subject_template: string;
  estimate_send_body_template: string;
  invoice_send_subject_template: string;
  invoice_send_body_template: string;
```

- [ ] **Step 7: Update `src/lib/types.ts` — `Estimate` and `Invoice` interfaces**

Open `src/lib/types.ts`. Find the `Estimate` interface (declared around line 534). Add inside the interface body:

```ts
  last_sent_at: string | null;
  last_sent_to_email: string | null;
```

Find the `Invoice` interface (declared around line 69). Add the same two lines inside its body.

- [ ] **Step 8: Run tsc to verify no type errors**

```bash
npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 9: Commit**

```bash
git add supabase/migration-build67c2-send-via-email.sql src/lib/payments/types.ts src/lib/types.ts
git commit -m "$(cat <<'EOF'
db(67c2): T1 schema deltas — payment_email_settings templates + last_sent_* on estimates/invoices + contract_events CHECK widen

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `html-to-text` helper

**Files:**
- Create: `src/lib/email/html-to-text.ts`

- [ ] **Step 1: Create the helper**

```ts
// Build 67c2 — convert resolved-template HTML body to plain text for the
// send modal's <Textarea>. Templates stored in payment_email_settings are
// HTML; the modal renders text-in / HTML-out (see text-to-html.ts).
//
// Not a full HTML parser. Templates are well-formed and small. Mirrors the
// regex-based decode in src/lib/contracts/email-merge-fields.ts:48.

export function htmlToText(html: string): string {
  let s = html;

  // Block-level breaks
  s = s.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n");
  s = s.replace(/<\/?p[^>]*>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/?div[^>]*>/gi, "\n");

  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, "");

  // Decode the common five entities
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Collapse triple-or-more newlines into double; trim
  s = s.replace(/\n{3,}/g, "\n\n").trim();

  return s;
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email/html-to-text.ts
git commit -m "$(cat <<'EOF'
feat(67c2): T2 add html-to-text helper for send-modal body field

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `text-to-html` helper

**Files:**
- Create: `src/lib/email/text-to-html.ts`

- [ ] **Step 1: Create the helper**

```ts
// Build 67c2 — wrap user-edited plain-text body back into HTML before sending.
// Pairs with html-to-text.ts. The user types in a textarea (text), but
// outgoing emails are HTML for consistency with payments + contracts.
//
// Anything the user pastes is treated as text — pasted HTML is escaped, not
// rendered. This is intentional and safer than parsing arbitrary pasted HTML.

export function textToHtml(text: string): string {
  // 1. HTML-escape the five special chars
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  // 2. Split into paragraphs on blank lines, each paragraph wraps in <p>,
  //    single line breaks become <br>.
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`);

  return paragraphs.join("\n");
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email/text-to-html.ts
git commit -m "$(cat <<'EOF'
feat(67c2): T3 add text-to-html helper for send-route body wrap

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Template resolver

**Files:**
- Create: `src/lib/email/template-resolver.ts`

- [ ] **Step 1: Confirm the merge-field builder signature**

Open `src/lib/contracts/merge-fields.ts` and read the export `buildMergeFieldValues`. Confirm the signature is `(supabase: SupabaseClient, jobId: string) => Promise<Record<string, string | null>>` (or similar). If the return type differs, adjust the resolver wrapper accordingly.

Also open `src/lib/contracts/email-merge-fields.ts` and look at `applyMergeFieldValues` — this is what does the actual `{token}` substitution.

- [ ] **Step 2: Create the resolver**

```ts
// Build 67c2 — resolve {merge_field} tokens in estimate/invoice send
// templates against the document's job. Returns subject + html + the list
// of fields that didn't have a value so the modal can warn the user.
//
// Wraps buildMergeFieldValues from contracts/merge-fields with no extras.
// We avoid importing from contracts/* in non-contract code paths in route
// handlers; this thin wrapper is the layering boundary.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMergeFieldValues } from "@/lib/contracts/merge-fields";
import { applyMergeFieldValues } from "@/lib/contracts/email-merge-fields";

export interface ResolvedTemplate {
  subject: string;
  html: string;
  unresolvedFields: string[];
}

export async function resolveDocumentTemplate(
  supabase: SupabaseClient,
  subjectTemplate: string,
  bodyTemplate: string,
  jobId: string,
): Promise<ResolvedTemplate> {
  const values = await buildMergeFieldValues(supabase, jobId);

  const subjResult = applyMergeFieldValues(subjectTemplate, values);
  // Subject is plain text; decode entities the resolver introduced.
  const subject = subjResult.html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const bodyResult = applyMergeFieldValues(bodyTemplate, values);

  const unresolvedFields = Array.from(
    new Set([...subjResult.unresolvedFields, ...bodyResult.unresolvedFields]),
  );

  return { subject, html: bodyResult.html, unresolvedFields };
}
```

**Important:** if `applyMergeFieldValues` returns a different shape than `{ html, unresolvedFields }` (e.g., a different property name), adjust accordingly. Read its actual signature in Step 1 before writing the resolver.

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/email/template-resolver.ts
git commit -m "$(cat <<'EOF'
feat(67c2): T4 add document template resolver wrapper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Send module

**Files:**
- Create: `src/lib/email/send.ts`

- [ ] **Step 1: Confirm the existing send-pipeline shape**

Open `src/lib/payments/email.ts` (lines 1-160 already documented in spec). Note the structure:
- `sendViaResend(settings, to, subject, html, attachments)` returns `{ messageId, provider: "resend" }`
- `sendViaSmtp(supabase, accountId, settings, to, subject, html, attachments)` returns `{ messageId, provider: "smtp" }`
- `sendPaymentEmail` is the dispatcher

The new `src/lib/email/send.ts` mirrors this shape with `sendOrgEmail` as the dispatcher, but loads `payment_email_settings` internally given an `orgId`.

- [ ] **Step 2: Create the module**

```ts
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
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/email/send.ts
git commit -m "$(cat <<'EOF'
feat(67c2): T5 add sendOrgEmail dispatcher (Resend + SMTP)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Estimate preview route

**Files:**
- Create: `src/app/api/estimates/[id]/send/preview/route.ts`

- [ ] **Step 1: Verify the existing pdf route's permission + load patterns**

Open `src/app/api/estimates/[id]/pdf/route.ts` and confirm the auth/permission preamble pattern (`createServerSupabaseClient`, `requirePermission(supabase, 'manage_estimates')`, `getActiveOrganizationId`). Mirror the same shape in the new preview route.

- [ ] **Step 2: Create the preview route**

```ts
// Build 67c2 — GET /api/estimates/[id]/send/preview
// Returns the resolved-template subject + body (HTML→text) for the send modal.
//
// Status-based blocks (voided / converted / rejected) do NOT block this route.
// The Send button in the read-only view is the UI gate; this route just
// answers "what would this email look like."

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { resolveDocumentTemplate } from "@/lib/email/template-resolver";
import { htmlToText } from "@/lib/email/html-to-text";
import { loadOrgEmailSettings } from "@/lib/email/send";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_estimates");
  if (!gate.ok) return gate.response;

  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) {
    return NextResponse.json({ error: "no active organization" }, { status: 400 });
  }

  const { id } = await context.params;

  // Load estimate to get job_id + verify org match
  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, organization_id, job_id")
    .eq("id", id)
    .maybeSingle<{ id: string; organization_id: string; job_id: string }>();

  if (!estimate) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (estimate.organization_id !== orgId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Load settings + check from-email configured
  const settings = await loadOrgEmailSettings(supabase, orgId);
  if (!settings) {
    return NextResponse.json({ error: "settings missing" }, { status: 500 });
  }
  if (!settings.send_from_email) {
    return NextResponse.json({ from_unconfigured: true }, { status: 200 });
  }

  // Resolve template
  const resolved = await resolveDocumentTemplate(
    supabase,
    settings.estimate_send_subject_template,
    settings.estimate_send_body_template,
    estimate.job_id,
  );

  return NextResponse.json({
    from_unconfigured: false,
    subject: resolved.subject,
    body_text: htmlToText(resolved.html),
    unresolvedFields: resolved.unresolvedFields,
  });
}
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/estimates/[id]/send/preview/route.ts
git commit -m "$(cat <<'EOF'
feat(67c2): T6 GET /api/estimates/[id]/send/preview

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Invoice preview route

**Files:**
- Create: `src/app/api/invoices/[id]/send/preview/route.ts`

- [ ] **Step 1: Create the route (mirror of Task 6)**

```ts
// Build 67c2 — GET /api/invoices/[id]/send/preview
// Same shape as the estimate preview route, with manage_invoices permission
// and invoice_send_*_template columns.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { resolveDocumentTemplate } from "@/lib/email/template-resolver";
import { htmlToText } from "@/lib/email/html-to-text";
import { loadOrgEmailSettings } from "@/lib/email/send";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_invoices");
  if (!gate.ok) return gate.response;

  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) {
    return NextResponse.json({ error: "no active organization" }, { status: 400 });
  }

  const { id } = await context.params;

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, organization_id, job_id")
    .eq("id", id)
    .maybeSingle<{ id: string; organization_id: string; job_id: string }>();

  if (!invoice) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (invoice.organization_id !== orgId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const settings = await loadOrgEmailSettings(supabase, orgId);
  if (!settings) {
    return NextResponse.json({ error: "settings missing" }, { status: 500 });
  }
  if (!settings.send_from_email) {
    return NextResponse.json({ from_unconfigured: true }, { status: 200 });
  }

  const resolved = await resolveDocumentTemplate(
    supabase,
    settings.invoice_send_subject_template,
    settings.invoice_send_body_template,
    invoice.job_id,
  );

  return NextResponse.json({
    from_unconfigured: false,
    subject: resolved.subject,
    body_text: htmlToText(resolved.html),
    unresolvedFields: resolved.unresolvedFields,
  });
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/invoices/[id]/send/preview/route.ts
git commit -m "$(cat <<'EOF'
feat(67c2): T7 GET /api/invoices/[id]/send/preview

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Estimate send route

**Files:**
- Create: `src/app/api/estimates/[id]/send/route.ts`

- [ ] **Step 1: Read the existing estimate PDF route to reuse the renderer entry point**

Open `src/app/api/estimates/[id]/pdf/route.ts` and identify the function or pattern that renders + uploads the PDF. The send route reuses the same render+upload step (don't duplicate; if it's not factored out, factor it out into a helper as a small Step 2 inside this task before writing the send handler).

If the renderer code is inline in `pdf/route.ts`, the cleanest approach is to extract the render+upload portion to a shared helper at `src/lib/pdf-renderer/render-and-upload.ts` (or similar) and have both routes call it. Otherwise the send route duplicates the rendering logic.

- [ ] **Step 2: Extract render+upload helper if not already shared**

If `src/app/api/estimates/[id]/pdf/route.ts` has inline render+upload code (likely), create `src/lib/pdf-renderer/render-and-upload.ts` exporting:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RenderEstimatePdfArgs {
  supabase: SupabaseClient;
  estimateId: string;
  presetId: string;
  orgId: string;
}

export interface RenderInvoicePdfArgs {
  supabase: SupabaseClient;
  invoiceId: string;
  presetId: string;
  orgId: string;
}

export interface PdfRenderResult {
  buffer: Buffer;
  storage_path: string;
  download_url: string;
  filename: string;
}

export async function renderAndUploadEstimatePdf(args: RenderEstimatePdfArgs): Promise<PdfRenderResult>;
export async function renderAndUploadInvoicePdf(args: RenderInvoicePdfArgs): Promise<PdfRenderResult>;
```

The implementation moves verbatim from the existing pdf routes. After extraction, `src/app/api/estimates/[id]/pdf/route.ts` and `src/app/api/invoices/[id]/pdf/route.ts` are updated to call the helpers — keep their public response shapes identical so existing callers don't break.

If the existing pdf routes already factor this out (verify by reading the file), skip Step 2 and import directly in Step 3.

- [ ] **Step 3: Create the estimate send route**

```ts
// Build 67c2 — POST /api/estimates/[id]/send
// Renders PDF → uploads to Storage → sends email → atomically updates
// estimate row + writes contract_events audit row. Failures at any
// pre-email step leave the document state untouched.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { sendOrgEmail, FromUnconfiguredError } from "@/lib/email/send";
import { textToHtml } from "@/lib/email/text-to-html";
import { renderAndUploadEstimatePdf } from "@/lib/pdf-renderer/render-and-upload";
import { apiDbError } from "@/lib/api-errors";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BLOCKED_STATUSES = new Set(["voided", "converted"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_estimates");
  if (!gate.ok) return gate.response;

  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) {
    return NextResponse.json({ error: "no active organization" }, { status: 400 });
  }

  const { id } = await context.params;

  let body: { to?: unknown; subject?: unknown; body?: unknown; preset_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const to = typeof body.to === "string" ? body.to.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyText = typeof body.body === "string" ? body.body : "";
  const preset_id = typeof body.preset_id === "string" ? body.preset_id : "";

  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: "valid recipient email required" }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ error: "subject required" }, { status: 400 });
  }
  if (!bodyText) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  if (!preset_id) {
    return NextResponse.json({ error: "preset_id required" }, { status: 400 });
  }

  // Load estimate
  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, organization_id, status, sent_at, estimate_number, job_id")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      status: string;
      sent_at: string | null;
      estimate_number: string;
      job_id: string;
    }>();

  if (!estimate || estimate.organization_id !== orgId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (BLOCKED_STATUSES.has(estimate.status)) {
    return NextResponse.json(
      { error: `cannot send a ${estimate.status} estimate` },
      { status: 400 },
    );
  }

  // Verify preset belongs to org + matches document_type
  const { data: preset } = await supabase
    .from("pdf_presets")
    .select("id, organization_id, document_type")
    .eq("id", preset_id)
    .maybeSingle<{ id: string; organization_id: string; document_type: string }>();

  if (
    !preset ||
    preset.organization_id !== orgId ||
    preset.document_type !== "estimate"
  ) {
    return NextResponse.json({ error: "invalid preset" }, { status: 400 });
  }

  // Render + upload PDF
  let pdf;
  try {
    pdf = await renderAndUploadEstimatePdf({
      supabase,
      estimateId: id,
      presetId: preset_id,
      orgId,
    });
  } catch (e) {
    return apiDbError(
      e instanceof Error ? e.message : String(e),
      "POST /api/estimates/[id]/send render",
    );
  }

  // Send email
  let result;
  try {
    result = await sendOrgEmail(supabase, orgId, {
      to,
      subject,
      html: textToHtml(bodyText),
      attachments: [
        {
          filename: pdf.filename,
          content: pdf.buffer,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (e) {
    if (e instanceof FromUnconfiguredError) {
      return NextResponse.json(
        { error: "from_unconfigured" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  // Update document + write audit
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    last_sent_at: now,
    last_sent_to_email: to,
  };
  if (estimate.status === "draft") {
    updates.status = "sent";
    updates.sent_at = now;
  }

  const { error: updateErr } = await supabase
    .from("estimates")
    .update(updates)
    .eq("id", id);

  if (updateErr) {
    return apiDbError(
      updateErr.message,
      "POST /api/estimates/[id]/send update",
    );
  }

  // Audit row — best effort; failure does not roll back the send.
  await supabase.from("contract_events").insert({
    organization_id: orgId,
    contract_id: null,
    signer_id: null,
    event_type: "estimate_sent",
    metadata: {
      estimate_id: id,
      recipient: to,
      preset_id,
      message_id: result.messageId,
      provider: result.provider,
    },
  });

  return NextResponse.json({
    ok: true,
    message_id: result.messageId,
    sent_at: estimate.status === "draft" ? now : estimate.sent_at,
    last_sent_at: now,
    last_sent_to_email: to,
  });
}
```

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output. If `apiDbError` import fails, verify its path in `src/lib/api-errors.ts` — it was added in 67a hardening sweep.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/estimates/[id]/send/route.ts src/lib/pdf-renderer/render-and-upload.ts src/app/api/estimates/[id]/pdf/route.ts src/app/api/invoices/[id]/pdf/route.ts 2>/dev/null
git commit -m "$(cat <<'EOF'
feat(67c2): T8 POST /api/estimates/[id]/send + extract render-and-upload helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(If Step 2 didn't extract a helper because the existing pdf routes already shared one, drop the helper paths from the `git add`.)

---

## Task 9: Invoice send route (replace stub)

**Files:**
- Modify (replace contents): `src/app/api/invoices/[id]/send/route.ts`

- [ ] **Step 1: Replace the stub**

Open `src/app/api/invoices/[id]/send/route.ts` (currently a 39-line stub that just flips draft→sent). Replace its entire contents with:

```ts
// Build 67c2 — POST /api/invoices/[id]/send
// Mirrors the estimate send route. Differences:
//   - Permission: manage_invoices
//   - Status check: 400 only when status === 'voided'
//   - Audit event_type: 'invoice_sent'
//   - QB sync trigger fires automatically on the draft → sent transition
//     (existing trigger; not re-fired on subsequent sends).
//
// This replaces the 67b stub that only flipped draft → sent without
// actually emailing. The companion /api/invoices/[id]/mark-sent route is
// left in place — it remains the no-email "mark as delivered" path.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { sendOrgEmail, FromUnconfiguredError } from "@/lib/email/send";
import { textToHtml } from "@/lib/email/text-to-html";
import { renderAndUploadInvoicePdf } from "@/lib/pdf-renderer/render-and-upload";
import { apiDbError } from "@/lib/api-errors";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_invoices");
  if (!gate.ok) return gate.response;

  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) {
    return NextResponse.json({ error: "no active organization" }, { status: 400 });
  }

  const { id } = await context.params;

  let body: { to?: unknown; subject?: unknown; body?: unknown; preset_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const to = typeof body.to === "string" ? body.to.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyText = typeof body.body === "string" ? body.body : "";
  const preset_id = typeof body.preset_id === "string" ? body.preset_id : "";

  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: "valid recipient email required" }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ error: "subject required" }, { status: 400 });
  }
  if (!bodyText) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  if (!preset_id) {
    return NextResponse.json({ error: "preset_id required" }, { status: 400 });
  }

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, organization_id, status, sent_at, invoice_number, job_id")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      status: string;
      sent_at: string | null;
      invoice_number: string;
      job_id: string;
    }>();

  if (!invoice || invoice.organization_id !== orgId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (invoice.status === "voided") {
    return NextResponse.json({ error: "cannot send a voided invoice" }, { status: 400 });
  }

  const { data: preset } = await supabase
    .from("pdf_presets")
    .select("id, organization_id, document_type")
    .eq("id", preset_id)
    .maybeSingle<{ id: string; organization_id: string; document_type: string }>();

  if (
    !preset ||
    preset.organization_id !== orgId ||
    preset.document_type !== "invoice"
  ) {
    return NextResponse.json({ error: "invalid preset" }, { status: 400 });
  }

  let pdf;
  try {
    pdf = await renderAndUploadInvoicePdf({
      supabase,
      invoiceId: id,
      presetId: preset_id,
      orgId,
    });
  } catch (e) {
    return apiDbError(
      e instanceof Error ? e.message : String(e),
      "POST /api/invoices/[id]/send render",
    );
  }

  let result;
  try {
    result = await sendOrgEmail(supabase, orgId, {
      to,
      subject,
      html: textToHtml(bodyText),
      attachments: [
        {
          filename: pdf.filename,
          content: pdf.buffer,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (e) {
    if (e instanceof FromUnconfiguredError) {
      return NextResponse.json(
        { error: "from_unconfigured" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    last_sent_at: now,
    last_sent_to_email: to,
  };
  if (invoice.status === "draft") {
    updates.status = "sent";
    updates.sent_at = now;
  }

  const { error: updateErr } = await supabase
    .from("invoices")
    .update(updates)
    .eq("id", id);

  if (updateErr) {
    return apiDbError(
      updateErr.message,
      "POST /api/invoices/[id]/send update",
    );
  }

  await supabase.from("contract_events").insert({
    organization_id: orgId,
    contract_id: null,
    signer_id: null,
    event_type: "invoice_sent",
    metadata: {
      invoice_id: id,
      recipient: to,
      preset_id,
      message_id: result.messageId,
      provider: result.provider,
    },
  });

  return NextResponse.json({
    ok: true,
    message_id: result.messageId,
    sent_at: invoice.status === "draft" ? now : invoice.sent_at,
    last_sent_at: now,
    last_sent_to_email: to,
  });
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/invoices/[id]/send/route.ts
git commit -m "$(cat <<'EOF'
feat(67c2): T9 replace invoices/[id]/send stub with full send logic

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Settings PATCH accept-shape

**Files:**
- Modify: `src/app/api/settings/payment-email/route.ts`

- [ ] **Step 1: Add the 4 new template fields to the `stringFields` array**

Open `src/app/api/settings/payment-email/route.ts`. Find the `stringFields` array declaration (currently around lines 62-79). Add the new fields to the array:

```ts
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
```

- [ ] **Step 2: Add length validation (max 5,000 chars per template)**

Inside the `for (const f of stringFields)` loop, replace the body with:

```ts
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
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/settings/payment-email/route.ts
git commit -m "$(cat <<'EOF'
feat(67c2): T10 PATCH /api/settings/payment-email accepts new template fields

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Settings nav rename

**Files:**
- Modify: `src/lib/settings-nav.ts:52`

- [ ] **Step 1: Rename the label**

Open `src/lib/settings-nav.ts`. Find line 52:

```ts
  { href: "/settings/payments", label: "Payment Emails", icon: Mail },
```

Change to:

```ts
  { href: "/settings/payments", label: "Outgoing Emails", icon: Mail },
```

The `href` stays `/settings/payments` (table name unchanged; URL unchanged).

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings-nav.ts
git commit -m "$(cat <<'EOF'
ui(67c2): T11 settings nav label "Payment Emails" → "Outgoing Emails"

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Settings UI — heading + 4 new template editors

**Files:**
- Modify: `src/app/settings/payments/page.tsx`

- [ ] **Step 1: Read the existing template-editor pattern**

Open `src/app/settings/payments/page.tsx`. Skim how existing template editors are rendered — they use `<PaymentEmailTemplateField>` from `./payment-email-template-field`. Find an existing block (for example the `payment_request_subject_template` editor) and copy its shape.

Read `src/app/settings/payments/payment-email-template-field.tsx` to confirm its props shape:

- It likely takes `label`, `value`, `onChange`, possibly `helpText` and `mergeFields`.
- Use the same shape for the new editors.

- [ ] **Step 2: Update the page heading**

Find the page's `<h1>` (or equivalent heading element). Change "Payment Emails" → "Outgoing Emails". If there's a subtitle / description paragraph mentioning payment requests only, update it to "from-address used for payment requests, estimate sends, and invoice sends."

- [ ] **Step 3: Add 4 new `<PaymentEmailTemplateField>` editors**

Below the existing template editors (after the last `payment_*_template` block), add:

```tsx
        {/* Build 67c2 — Estimate send templates */}
        <PaymentEmailTemplateField
          label="Estimate send — Subject"
          value={settings.estimate_send_subject_template}
          onChange={(v) => patch("estimate_send_subject_template", v)}
        />
        <PaymentEmailTemplateField
          label="Estimate send — Body"
          value={settings.estimate_send_body_template}
          onChange={(v) => patch("estimate_send_body_template", v)}
        />

        {/* Build 67c2 — Invoice send templates */}
        <PaymentEmailTemplateField
          label="Invoice send — Subject"
          value={settings.invoice_send_subject_template}
          onChange={(v) => patch("invoice_send_subject_template", v)}
        />
        <PaymentEmailTemplateField
          label="Invoice send — Body"
          value={settings.invoice_send_body_template}
          onChange={(v) => patch("invoice_send_body_template", v)}
        />
```

If `<PaymentEmailTemplateField>` requires additional props (e.g., `multiline` boolean or `mergeFields` array), match the shape used by `payment_request_body_template` for the body fields and `payment_request_subject_template` for the subject fields.

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 5: Verify the page loads in the browser preview**

Start the preview if not already running (Claude Preview MCP). Navigate to `/settings/payments`. Confirm:
- Heading reads "Outgoing Emails"
- 4 new editor sections visible at the bottom
- Subject/body fields populated with the seeded defaults from Task 1

- [ ] **Step 6: Commit**

```bash
git add src/app/settings/payments/page.tsx
git commit -m "$(cat <<'EOF'
ui(67c2): T12 settings page heading + 4 new template editors

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Send modal component

**Files:**
- Create: `src/components/send-modal/index.tsx`

- [ ] **Step 1: Read the existing modal for structural reference**

Open `src/components/export-pdf-modal/index.tsx` (the 67c1 Export modal). Skim its Dialog scaffold, preset-loading pattern, and submit handler. The send modal mirrors this structure but adds To/Subject/Body fields.

Also open `src/components/payments/payment-request-modal.tsx` lines 1-130 — the recipient prefill pattern from `/api/jobs/{jobId}/contact-email` is the same.

- [ ] **Step 2: Create the modal**

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

interface PdfPreset {
  id: string;
  name: string;
  document_type: "estimate" | "invoice";
  is_default: boolean;
}

interface PreviewResponse {
  from_unconfigured: boolean;
  subject?: string;
  body_text?: string;
  unresolvedFields?: string[];
}

export type SendModalProps =
  | {
      open: boolean;
      onOpenChange: (o: boolean) => void;
      mode: "estimate";
      documentId: string;
      jobId: string;
      onSent?: () => void;
    }
  | {
      open: boolean;
      onOpenChange: (o: boolean) => void;
      mode: "invoice";
      documentId: string;
      jobId: string;
      onSent?: () => void;
    };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SendModal(props: SendModalProps) {
  const { open, onOpenChange, mode, documentId, jobId, onSent } = props;

  const [loading, setLoading] = useState(true);
  const [fromUnconfigured, setFromUnconfigured] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [unresolvedFields, setUnresolvedFields] = useState<string[]>([]);
  const [presets, setPresets] = useState<PdfPreset[]>([]);
  const [presetId, setPresetId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setFromUnconfigured(false);
    setTo("");
    setSubject("");
    setBodyText("");
    setUnresolvedFields([]);
    setPresets([]);
    setPresetId("");

    Promise.all([
      fetch(`/api/${mode === "estimate" ? "estimates" : "invoices"}/${documentId}/send/preview`).then(
        (r) => (r.ok ? r.json() : { from_unconfigured: false }),
      ) as Promise<PreviewResponse>,
      fetch(`/api/jobs/${jobId}/contact-email`).then(
        (r) => (r.ok ? r.json() : { email: null, name: null }),
      ) as Promise<{ email: string | null; name: string | null }>,
      fetch(`/api/pdf-presets?document_type=${mode}`).then(
        (r) => (r.ok ? r.json() : []),
      ) as Promise<PdfPreset[]>,
    ]).then(([preview, contact, pdfPresets]) => {
      if (cancelled) return;
      if (preview.from_unconfigured) {
        setFromUnconfigured(true);
      } else {
        setSubject(preview.subject ?? "");
        setBodyText(preview.body_text ?? "");
        setUnresolvedFields(preview.unresolvedFields ?? []);
      }
      setTo(contact.email ?? "");
      setPresets(pdfPresets);
      const def = pdfPresets.find((p) => p.is_default);
      setPresetId(def?.id ?? pdfPresets[0]?.id ?? "");
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, mode, documentId, jobId]);

  async function onSubmit() {
    const trimmedTo = to.trim();
    if (!EMAIL_RE.test(trimmedTo)) {
      toast.error("Enter a valid recipient email");
      return;
    }
    if (!subject.trim()) {
      toast.error("Subject required");
      return;
    }
    if (!bodyText.trim()) {
      toast.error("Body required");
      return;
    }
    if (!presetId) {
      toast.error("Select a PDF preset");
      return;
    }

    setSubmitting(true);
    const url = `/api/${mode === "estimate" ? "estimates" : "invoices"}/${documentId}/send`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: trimmedTo, subject, body: bodyText, preset_id: presetId }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(err.error || `Send failed (${res.status})`);
      return;
    }
    toast.success(`Sent to ${trimmedTo}`);
    onOpenChange(false);
    onSent?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Send {mode === "estimate" ? "Estimate" : "Invoice"}
          </DialogTitle>
          <DialogDescription>
            The PDF is generated and attached using the selected preset.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : fromUnconfigured ? (
          <div className="py-6 space-y-3">
            <p className="text-sm">
              Configure your sending email first.
            </p>
            <Link
              href="/settings/payments"
              className="text-sm font-medium text-[var(--brand-primary)] hover:underline"
              onClick={() => onOpenChange(false)}
            >
              Open Outgoing Emails settings →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="send-to">To</Label>
              <Input
                id="send-to"
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="recipient@example.com"
              />
            </div>
            <div>
              <Label htmlFor="send-subject">Subject</Label>
              <Input
                id="send-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="send-body">Body</Label>
              <Textarea
                id="send-body"
                rows={10}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="send-preset">PDF Preset</Label>
              <Select value={presetId} onValueChange={setPresetId}>
                <SelectTrigger id="send-preset">
                  <SelectValue placeholder="Select preset" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.is_default ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {unresolvedFields.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-2 text-xs text-yellow-900">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div>
                  Unresolved merge fields:{" "}
                  {unresolvedFields.map((f) => `{${f}}`).join(", ")}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          {!loading && !fromUnconfigured && (
            <Button onClick={onSubmit} disabled={submitting}>
              {submitting ? "Sending…" : "Send"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output. Common failure: `<Textarea>` import path. Check `src/components/ui/textarea.tsx` exists (shadcn). If missing, install via shadcn CLI or use an existing project alternative — but this is a standard shadcn primitive likely already installed.

- [ ] **Step 4: Commit**

```bash
git add src/components/send-modal/index.tsx
git commit -m "$(cat <<'EOF'
feat(67c2): T13 SendModal component (estimate + invoice modes)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Send button wrapper

**Files:**
- Create: `src/components/send-modal/button.tsx`

- [ ] **Step 1: Read the analogous Export button wrapper**

Open `src/components/export-pdf-modal/button.tsx`. Note the prop shape and how it's used by `src/app/estimates/[id]/page.tsx` and the invoice read-only client. Mirror this shape so the new SendButton plugs in identically.

- [ ] **Step 2: Create the button wrapper**

```tsx
"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/use-auth";
import { SendModal } from "./index";

export type SendButtonProps =
  | {
      mode: "estimate";
      documentId: string;
      jobId: string;
      status: string; // EstimateStatus value
    }
  | {
      mode: "invoice";
      documentId: string;
      jobId: string;
      status: string; // InvoiceStatus value
    };

export function SendButton(props: SendButtonProps) {
  const { mode, documentId, jobId, status } = props;
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { hasPermission } = useAuth();

  const permissionKey =
    mode === "estimate" ? "manage_estimates" : "manage_invoices";
  const canManage = hasPermission(permissionKey);

  const blockedStatuses =
    mode === "estimate" ? ["voided", "converted"] : ["voided"];
  const disabled = blockedStatuses.includes(status);

  if (!canManage) return null;

  const tooltip = disabled
    ? `Cannot send a ${status} ${mode}.`
    : undefined;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={tooltip}
        variant="default"
      >
        <Send size={14} className="mr-1.5" />
        Send
      </Button>
      <SendModal
        open={open}
        onOpenChange={setOpen}
        mode={mode}
        documentId={documentId}
        jobId={jobId}
        onSent={() => router.refresh()}
      />
    </>
  );
}
```

- [ ] **Step 3: Verify the `useAuth` hook signature**

Open `src/lib/auth/use-auth.ts` (or wherever `useAuth` lives). Confirm it returns `hasPermission(key: string): boolean`. If the actual signature differs (e.g., `hasPermission` is async, or the import path is `@/lib/auth/auth-context`), adjust the import + call accordingly.

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output. If `useAuth` import fails, find the correct path with grep:

```bash
grep -rn "export.*function useAuth\|export.*const useAuth" src/ | head -5
```

- [ ] **Step 5: Commit**

```bash
git add src/components/send-modal/button.tsx
git commit -m "$(cat <<'EOF'
feat(67c2): T14 SendButton wrapper (perm-gated, status-disabled)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Wire SendButton into estimate read-only page

**Files:**
- Modify: `src/app/estimates/[id]/page.tsx`

- [ ] **Step 1: Add the import**

Open `src/app/estimates/[id]/page.tsx`. Find the existing import:

```ts
import { ExportPdfButton } from "@/components/export-pdf-modal/button";
```

Add directly below it:

```ts
import { SendButton } from "@/components/send-modal/button";
```

- [ ] **Step 2: Render `<SendButton>` next to `<ExportPdfButton>`**

Find where `<ExportPdfButton>` is rendered in the JSX (likely in the page header / action row). Add `<SendButton>` adjacent. The exact JSX depends on the existing structure; the pattern is:

```tsx
<SendButton
  mode="estimate"
  documentId={estimate.id}
  jobId={estimate.job_id}
  status={estimate.status}
/>
<ExportPdfButton documentType="estimate" /* ...existing props... */ />
```

Place `<SendButton>` BEFORE `<ExportPdfButton>` so Send appears to the left of Export (more action-significant on the left). If the existing layout sorts buttons by alphabet or another rule, follow that rule instead.

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Verify in browser preview**

Navigate to an estimate's read-only page (`/estimates/<some-id>`). Confirm:
- Send button appears next to Export.
- Click opens the modal; subject + body prefilled; preset dropdown shows defaults.
- Modal Cancel closes without errors.
- Send button is hidden if you're on a `voided` or `converted` estimate (use SQL to set status if no test data exists).

(Don't actually send a test email yet — that's Task 17.)

- [ ] **Step 5: Commit**

```bash
git add src/app/estimates/[id]/page.tsx
git commit -m "$(cat <<'EOF'
ui(67c2): T15 wire SendButton into estimate read-only page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Wire SendButton into invoice read-only client + remove old Send

**Files:**
- Modify: `src/components/invoices/invoice-read-only-client.tsx`

- [ ] **Step 1: Add the SendButton import**

Open `src/components/invoices/invoice-read-only-client.tsx`. Add to the imports:

```ts
import { SendButton } from "@/components/send-modal/button";
```

- [ ] **Step 2: Remove the old Send button + handler**

Delete the existing `handleSend` function (lines ~36-43 in the current file):

```ts
  async function handleSend() {
    const res = await fetch(`/api/invoices/${invoice.id}/send`, { method: "POST" });
    if (!res.ok) {
      toast.error("Send failed");
      return;
    }
    toast.success("Sent");
  }
```

Delete the existing inline Send button (lines ~64-68):

```tsx
{invoice.status === "draft" && (
  <button onClick={handleSend} className="btn btn-primary">
    Send
  </button>
)}
```

- [ ] **Step 3: Add `<SendButton>` in the same action-row position**

Where the old Send button was, render the new one. It handles its own visibility / disabled logic — no surrounding `{invoice.status === "draft" && ...}` wrapper needed:

```tsx
<SendButton
  mode="invoice"
  documentId={invoice.id}
  jobId={invoice.job?.id ?? ""}
  status={invoice.status}
/>
```

If `invoice.job?.id` could legitimately be null/undefined (orphan invoice — unlikely in practice), the SendButton receives empty string. The modal's `useEffect` will fail the `/api/jobs/{""}/contact-email` fetch quietly and proceed with empty `to`. Acceptable v1 behavior.

- [ ] **Step 4: Remove unused `toast` import if it's no longer referenced**

If `toast` was only used by the deleted `handleSend`, remove the `import { toast } from "sonner"` line. Otherwise leave it.

- [ ] **Step 5: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Verify in browser preview**

Navigate to an invoice's read-only page (`/invoices/<some-id>`). Confirm:
- Send button appears (replacing the previous one).
- Click opens the modal; subject + body prefilled with invoice template.
- Modal Cancel closes without errors.
- Send button is hidden on a `voided` invoice.

- [ ] **Step 7: Commit**

```bash
git add src/components/invoices/invoice-read-only-client.tsx
git commit -m "$(cat <<'EOF'
ui(67c2): T16 swap invoice read-only Send button for new SendButton

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: §11 manual test pass

**Files:**
- Create: `docs/superpowers/specs/2026-05-04-build-67c2-test-results.md`

This is the feature gate. Run all 12 cases from the spec's §11. Use the Claude Preview MCP for browser interactions and Supabase MCP `execute_sql` for DB verification.

**Test environment setup:**

- The dev server should be running (Claude Preview MCP `preview_start`).
- `payment_email_settings.send_from_email` must be configured for the AAA org. If empty, set it via the Outgoing Emails settings page first (you can use Eric's actual sending email — the feature requires a real Resend domain).
- A test estimate in `draft` status, a test invoice in `draft` status, and a test job with a contact email should exist. If not, create them via the UI.

- [ ] **Step 1: Test 1 — Send draft estimate to a valid recipient**

Open the estimate's read-only view → click Send → modal opens with subject + body prefilled → keep the preset dropdown on default → enter a valid recipient (use a `+` alias of your test email or a real address you own) → click Send.

Verify:
1. Toast: "Sent to <email>".
2. SQL: `SELECT status, sent_at, last_sent_at, last_sent_to_email FROM estimates WHERE id = '<id>';` — status `sent`, all three timestamps + email populated.
3. SQL: `SELECT event_type, metadata FROM contract_events WHERE metadata->>'estimate_id' = '<id>' ORDER BY created_at DESC LIMIT 1;` — `event_type='estimate_sent'`, metadata contains recipient + preset_id + message_id + provider.
4. Email arrives in the recipient's inbox with the PDF attached.

Record PASS/FAIL.

- [ ] **Step 2: Test 2 — Re-send same estimate to a different recipient**

From the same estimate (now `sent` status), open Send modal again → change To to a different valid email → click Send.

Verify:
1. Toast: "Sent to <new email>".
2. SQL: `last_sent_to_email` updated to new address; `last_sent_at` updated; `sent_at` unchanged from Test 1; status still `sent`.
3. New `contract_events` row written.

Record PASS/FAIL.

- [ ] **Step 3: Test 3 — Send blocked from voided estimate**

SQL: `UPDATE estimates SET status = 'voided' WHERE id = '<another-test-estimate>';`
Open that estimate's read-only view.

Verify:
1. Send button is disabled with tooltip "Cannot send a voided estimate."
2. Direct API call: `curl -X POST http://localhost:3000/api/estimates/<id>/send -H 'Content-Type: application/json' -d '{"to":"a@b.com","subject":"x","body":"x","preset_id":"<id>"}'` (with auth cookies via browser export or skip if too fiddly) — returns 400 "cannot send a voided estimate".

Record PASS/FAIL. Restore status: `UPDATE estimates SET status = 'draft' WHERE id = '<id>';`.

- [ ] **Step 4: Test 4 — Send blocked from converted estimate**

SQL: `UPDATE estimates SET status = 'converted' WHERE id = '<another-test-estimate>';`. Same verification as Test 3 with "converted" tooltip.

Record PASS/FAIL. Restore.

- [ ] **Step 5: Test 5 — Send draft invoice**

Open an invoice's read-only view → Send modal → enter recipient → Send.

Verify:
1. Toast: "Sent to <email>".
2. SQL: `SELECT status, sent_at, last_sent_at, last_sent_to_email, quickbooks_sync_status FROM invoices WHERE id = '<id>';` — status `sent`, all timestamps populated. If QB connected, `quickbooks_sync_status = 'pending'`; if not, `not_applicable`.
3. SQL: `contract_events` row with `event_type='invoice_sent'`.
4. Email arrives with PDF attached.

Record PASS/FAIL.

- [ ] **Step 6: Test 6 — Re-send invoice from `paid` (or `partial`)**

SQL: `UPDATE invoices SET status = 'paid' WHERE id = '<the-test-invoice-from-test-5>';`
(Or use a real paid invoice if one exists.)

Open the invoice → Send modal → Send.

Verify:
1. Toast success.
2. SQL: `last_sent_to_email` + `last_sent_at` updated; status remains `paid`; `sent_at` unchanged from Test 5; `quickbooks_sync_attempted_at` unchanged (QB trigger did NOT re-fire).
3. New audit row written.

Record PASS/FAIL. Restore status if you mutated it for the test.

- [ ] **Step 7: Test 7 — Empty from-email empty-state**

SQL: `UPDATE payment_email_settings SET send_from_email = '' WHERE organization_id = '<aaa org id>';`

Open any estimate → click Send.

Verify:
1. Modal renders an empty-state with "Configure your sending email first" + a link to `/settings/payments`.
2. Send button absent / disabled.

Record PASS/FAIL. Restore: `UPDATE payment_email_settings SET send_from_email = '<the-real-email>' WHERE organization_id = '<aaa org id>';`.

- [ ] **Step 8: Test 8 — Job with no contact email**

SQL: find a job with no contact email (or NULL the email of an existing test job): `UPDATE contacts SET email = NULL WHERE id = '<test-contact-id>';`. Open an estimate associated with that job → Send modal.

Verify:
1. To field is empty.
2. Manual entry of a valid email is accepted; Send works.

Record PASS/FAIL. Restore the email.

- [ ] **Step 9: Test 9 — Permission gate (SQL role flip per 67c1 pattern)**

SQL:
```sql
UPDATE user_organizations SET role = 'crew_lead'
 WHERE user_id = '<eric user id>' AND organization_id = '<aaa org id>';
UPDATE user_organization_permissions SET granted = false
 WHERE user_organization_id = (SELECT id FROM user_organizations WHERE user_id = '<eric>' AND organization_id = '<aaa>')
   AND permission_key = 'manage_estimates';
```

Reload the estimate read-only page.

Verify:
1. Send button hidden.
2. Direct POST to `/api/estimates/[id]/send` returns 403.

Record PASS/FAIL. Restore admin: `UPDATE user_organizations SET role = 'admin' ... ; UPDATE user_organization_permissions SET granted = true ...`.

Repeat the same flip for `manage_invoices` on an invoice page.

- [ ] **Step 10: Test 10 — Edit subject + body before sending**

Open Send modal → change subject to a unique test string → change body to a unique test string → Send.

Verify the email arrives with the edited content (not the template default). Verify SQL: the audit row's `metadata.recipient` matches the To you entered.

Record PASS/FAIL.

- [ ] **Step 11: Test 11 — PDF render failure**

Force a render error by temporarily breaking the renderer. Easiest path: set `pdf_presets.document_type = 'invalid'` for the chosen preset via SQL just before the test, then send.

```sql
UPDATE pdf_presets SET document_type = 'corrupted' WHERE id = '<preset id>';
```

Open Send modal → Send.

Verify:
1. Toast surfaces a redacted error message.
2. Modal stays open (user's edits preserved).
3. SQL: estimate status NOT transitioned; `last_sent_*` NOT stamped; no new `contract_events` row written.

Record PASS/FAIL. Restore the preset:
```sql
UPDATE pdf_presets SET document_type = 'estimate' WHERE id = '<preset id>';
```

(If the route's preset-validation rejects `'corrupted'` before render even starts, this test is satisfied — the error path differs but the assertions about state still hold.)

- [ ] **Step 12: Test 12 — Resend / SMTP send failure**

Force a Resend error. Easiest path: set the recipient to a known-bad address Resend rejects, e.g. `bounce@simulator.amazonses.com` (Resend will reject it). Or temporarily set `RESEND_API_KEY` to a bad value via env var if the dev server supports it.

Verify:
1. Toast surfaces a redacted provider error.
2. Modal stays open.
3. SQL: no state mutations.

Record PASS/FAIL. Restore env if mutated.

- [ ] **Step 13: Write the test results doc**

Create `docs/superpowers/specs/2026-05-04-build-67c2-test-results.md`:

```markdown
---
title: Build 67c2 — §11 Manual Test Results
date: 2026-05-04
build_id: 67c2
plan: docs/superpowers/plans/2026-05-04-build-67c2-send-via-email.md
---

# Build 67c2 — Manual Test Pass

Run against `<commit hash>` on dev preview, prod Supabase.

| # | Scenario | Result | Notes |
|---|---|---|---|
| 1 | Send draft estimate | <PASS/FAIL> | <one-line evidence> |
| 2 | Re-send estimate to different recipient | <PASS/FAIL> | |
| 3 | Send from voided estimate | <PASS/FAIL> | |
| 4 | Send from converted estimate | <PASS/FAIL> | |
| 5 | Send draft invoice (QB trigger) | <PASS/FAIL> | |
| 6 | Re-send paid invoice (QB no-fire) | <PASS/FAIL> | |
| 7 | Empty from-email empty-state | <PASS/FAIL> | |
| 8 | Job with no contact email | <PASS/FAIL> | |
| 9 | Permission gate (SQL role flip) | <PASS/FAIL> | |
| 10 | Edit subject + body | <PASS/FAIL> | |
| 11 | PDF render failure | <PASS/FAIL> | |
| 12 | Resend/SMTP failure | <PASS/FAIL> | |

## Inline fixes applied during the test pass

(List any fixes made + their commit hash, or "none" if all 12 passed clean.)

## Carry-overs

(List any minor follow-up nits that didn't block the pass, or "none".)
```

Fill in PASS/FAIL + evidence as you go through each test.

- [ ] **Step 14: tsc + build verification**

```bash
npx tsc --noEmit
npm run build
```

Expected: tsc clean, build succeeds, all pages compile.

- [ ] **Step 15: Commit the test results**

```bash
git add docs/superpowers/specs/2026-05-04-build-67c2-test-results.md
git commit -m "$(cat <<'EOF'
docs(67c2): T17 manual test results — <X>/<Y> PASS

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If any tests failed, file inline fixes with their own commits and re-run failing tests until they pass.

---

## Self-review checklist

After all 17 tasks pass:

1. **Spec coverage:** every numbered deliverable in spec §4 has at least one task. (1=T1, 2=T1, 3=T5, 4=T2+T3, 5=T4, 6=T8, 7=T9, 7a=T6, 7b=T7, 8=T1, 9=T13, 10=T14, 11=T15+T16, 12=T11+T12+T10, 13=T17.) ✓
2. **Decisions covered:** decisions 1-7 from spec §2 all reflected in task implementations. ✓
3. **Risks addressed:** spec §13 risks all have mitigations in tasks (constraint re-read in T1 step 1; missing-row INSERT in T1 step 3; QB trigger verified in T5 step 6 / Test 6).
4. **No new permission keys:** verified in T8/T9 (uses `manage_estimates`/`manage_invoices`); T10 keeps existing `access_settings`.
5. **No table rename:** verified — T11 only changes the nav label; T12 only changes the page heading.

If any item is N/A or exposes a gap, open a follow-up task.

---

## Completion criteria

- All 17 tasks complete; all commits on `main` (or the worktree branch if executed in isolation).
- §11 test pass: 12/12 PASS.
- `npx tsc --noEmit` clean at every commit.
- `npm run build` ✓ at session end.
- Migration `build67c2_send_via_email` applied to prod via Supabase MCP.
- Outgoing Emails settings page renders the 4 new editor sections; defaults visible.
- Send modal works end-to-end on at least one real estimate and one real invoice.
- Test results doc committed.

After completion, run `/handoff` to update `docs/vault/00-NOW.md` and write the dated handoff to `docs/vault/handoffs/`.
