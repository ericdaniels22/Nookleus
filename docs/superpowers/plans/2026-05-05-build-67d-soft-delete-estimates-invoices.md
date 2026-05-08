# Build 67d — Soft-delete + 30-day Trash for Estimates and Invoices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror Build 66's jobs soft-delete pattern onto `estimates` and `invoices`. Replace today's "Void" affordance on estimates with a unified Trash flow. Independent soft-delete on each side of the estimate ↔ invoice convert linkage. Hard-purge wipes the canonical PDF from `pdfs` Storage so the in-app cleanup path replaces today's SQL-only orphan recovery.

**Architecture:** Schema mirrors build66 (single `deleted_at` column + composite index per table, plus `delete_reason` text and an FK switch to `ON DELETE SET NULL` for the convert-linkage back-pointers, plus 6 new `contract_events.event_type` values). Three new routes per table (delete / restore / GET trash) plus a hard-purge `DELETE` that replaces today's `DELETE /api/estimates/[id]` "void" semantics. UI: trash subsumes void; per-job section gets a "Show trashed" toggle, global `/invoices` gets a Trash filter chip, read-only views get a trash banner.

**Tech Stack:** Next.js (App Router) on `next/dist`-vendored fork, Supabase Postgres + Storage + service-role client, base-ui primitives + tailwindcss, sonner for toasts. **No test framework** — verification is `npx tsc --noEmit` clean + manual §11 test pass against prod Supabase Test Co.

**Spec:** [docs/superpowers/specs/2026-05-05-build-67d-soft-delete-estimates-invoices-design.md](../specs/2026-05-05-build-67d-soft-delete-estimates-invoices-design.md)

**Reference implementation (Build 66 — copy-paste this shape):** `supabase/migration-build66-soft-delete-jobs.sql`, `src/app/api/jobs/{trash/route.ts,[id]/{delete,restore,route.ts}/route.ts}`, `src/lib/jobs/purge.ts`, `src/lib/jobs/auth.ts`.

---

## File structure

### New files
- `supabase/migration-build67d-soft-delete-estimates-invoices.sql` — schema delta
- `src/lib/documents/purge.ts` — shared Storage-cleanup helper for both estimate and invoice PDFs (one bucket, two flavors of path)
- `src/lib/api/assert-not-trashed.ts` — tiny gate helper used at every mutating route
- `src/app/api/estimates/[id]/delete/route.ts` — soft-delete
- `src/app/api/estimates/[id]/restore/route.ts` — restore
- `src/app/api/estimates/trash/route.ts` — list + lazy-purge
- `src/app/api/invoices/[id]/delete/route.ts`
- `src/app/api/invoices/[id]/restore/route.ts`
- `src/app/api/invoices/trash/route.ts`
- `src/components/trash/trash-confirm-dialog.tsx` — shared "Move to trash" dialog (estimate + invoice)
- `src/components/trash/force-delete-confirm-dialog.tsx` — shared "Delete now" dialog

### Modified files
- `src/lib/types.ts:69-103, 536-574` — add `deleted_at` and `delete_reason` to `Invoice` and `Estimate`
- `src/app/api/estimates/[id]/route.ts:71-92` — replace today's void-as-DELETE with hard-purge; add `deleted_at` guard to PUT
- `src/app/api/invoices/[id]/route.ts` — add new DELETE handler (hard-purge); add `deleted_at` guard to PUT
- `src/app/api/estimates/[id]/send/route.ts` + `…/preview/route.ts` — guard
- `src/app/api/invoices/[id]/send/route.ts` + `…/preview/route.ts` — guard
- `src/app/api/estimates/[id]/pdf/route.ts` + `src/app/api/invoices/[id]/pdf/route.ts` — guard
- `src/app/api/estimates/[id]/convert/route.ts` — guard on source
- `src/app/api/estimates/[id]/sections/route.ts` + `…/line-items/route.ts` + `…/line-items/[item_id]/route.ts` — guard
- `src/app/api/invoices/[id]/sections/route.ts` + `…/line-items/route.ts` + `…/line-items/[item_id]/route.ts` — guard
- `src/app/api/estimates/[id]/status/route.ts` + `src/app/api/invoices/[id]/{mark-sent,void}/route.ts` — guard
- `src/app/api/estimates/[id]/apply-template/route.ts` — guard
- `src/app/api/estimates/route.ts:39, 68` — add `.is("deleted_at", null)` to active-list GETs
- `src/app/api/invoices/route.ts:25` — same
- `src/components/job-detail/estimates-invoices-section.tsx` — replace inline VoidConfirmDialog with TrashConfirmDialog usage; add "Show trashed" toggle; Restore + Delete now inline actions; muted styling + days-left hint
- `src/components/invoices/invoice-list-client.tsx` — add Trash filter chip + trash list rendering
- `src/app/estimates/[id]/page.tsx` — read-only banner when trashed; hide Edit/Send/Export/Convert
- `src/app/invoices/[id]/page.tsx` — same shape
- `src/app/estimates/[id]/edit/page.tsx` — server-side redirect if trashed
- `src/app/invoices/[id]/edit/page.tsx` — same
- `convert_estimate_to_invoice` RPC — source-lookup `deleted_at IS NULL` filter (`CREATE OR REPLACE FUNCTION` in the migration file)

---

## Phase 0 — Pre-flight

### Task 1: Capture exact existing CHECK + FK definitions from prod

**Files:**
- Read-only — no file changes; output captured into the migration file in Task 2.

- [ ] **Step 1: Capture current `contract_events_event_type_check` allowed values**

Run via Supabase MCP `execute_sql`:

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'contract_events_event_type_check';
```

Expected: a `CHECK (event_type = ANY (ARRAY[…]))` definition listing the current values. Copy verbatim — the existing list (per 67c2 audit) is the 17 values:
```
'created','sent','email_delivered','email_opened','link_viewed',
'signed','reminder_sent','voided','expired','paid','payment_failed',
'refunded','partially_refunded','dispute_opened','dispute_closed',
'estimate_sent','invoice_sent'
```

If the captured list differs from 17 values, **stop and reconcile** — something landed since 67c2 wrap. Do not proceed with the wrong list.

- [ ] **Step 2: Capture current FK definitions for the convert-linkage back-pointers**

```sql
SELECT
  conname,
  pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN (
  'invoices_converted_from_estimate_id_fkey',
  'estimates_converted_to_invoice_id_fkey'
);
```

Expected: both definitions show `FOREIGN KEY ... REFERENCES ... (id)` with no explicit `ON DELETE` clause (defaults to `NO ACTION`). Confirm before proceeding to Task 2.

- [ ] **Step 3: Capture current invoice line-items FK + estimate sections FK to check they cascade**

```sql
SELECT
  conname,
  pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN (
  'estimate_sections_estimate_id_fkey',
  'estimate_line_items_estimate_id_fkey',
  'invoice_sections_invoice_id_fkey',
  'invoice_line_items_invoice_id_fkey'
);
```

Expected: each definition includes `ON DELETE CASCADE`. If any do not cascade, the hard-purge `DELETE FROM` in Task 12/16 would fail — flag and stop. (Per 00-NOW Recently learned: the `invoice_line_items.code` column was a latent issue surfaced in 67c1 T23; assume all CASCADE FKs are intact, but verify.)

- [ ] **Step 4: Capture `contract_events` parent-FK behavior**

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'contract_events'::regclass AND contype = 'f';
```

Expected: `contract_events` has no FK to `estimates` or `invoices` directly (today it's audit-only, joined via `metadata->>'estimate_id'`). Confirm — if a real FK exists, the spec's §9.7 "audit row written before parent DELETE so cascade doesn't take it" assumption is wrong and we'd need a DEFERRED constraint or to drop the cascade.

(If `contract_events` has no FK to estimates/invoices, audit rows survive the parent delete naturally — write order doesn't matter. Simpler than the spec assumed; document this in Task 2.)

- [ ] **Step 5: Save the captured strings into a scratch note**

Paste the 4 results into a temporary file `docs/superpowers/specs/2026-05-05-build-67d-preflight-capture.md` (gitignored or transient, your choice — it's just a clipboard between tasks). The migration in Task 2 needs them verbatim.

No commit on this task — pre-flight is purely captured state.

---

## Phase 1 — Migration

### Task 2: Write the migration file

**Files:**
- Create: `supabase/migration-build67d-soft-delete-estimates-invoices.sql`

- [ ] **Step 1: Write the file with this content**

```sql
-- Build 67d: Soft-delete + 30-day trash for estimates and invoices.
--
-- Mirror of build66's jobs pattern. Adds:
--   - estimates.deleted_at, estimates.delete_reason
--   - invoices.deleted_at,  invoices.delete_reason
--   - composite indexes on (organization_id, deleted_at) for both tables
--   - convert-linkage FKs switched to ON DELETE SET NULL (so independently
--     hard-purging one side never blocks the other side's purge)
--   - 6 new contract_events.event_type values
--   - convert_estimate_to_invoice RPC source-lookup deleted_at IS NULL guard
--
-- Lazy purge (>30 days) and the hard-delete itself are handled in the API
-- layer (mirrors src/app/api/jobs/trash/route.ts), since they need to delete
-- canonical PDFs from Storage in addition to cascading SQL rows.
--
-- Live constraint state captured at draft time (Task 1 pre-flight):
-- contract_events_event_type_check listed 17 values as of 67c2 wrap.
-- Both convert-linkage FKs were NO ACTION.

-- 1. New columns.
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delete_reason text;

-- 2. Composite indexes for the two list halves the UI needs:
--   WHERE organization_id = $1 AND deleted_at IS NULL      -- active list
--   WHERE organization_id = $1 AND deleted_at IS NOT NULL  -- trash list
CREATE INDEX IF NOT EXISTS idx_estimates_org_deleted_at
  ON estimates (organization_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_invoices_org_deleted_at
  ON invoices (organization_id, deleted_at);

-- 3. Convert-linkage FKs: NO ACTION → SET NULL.
-- Postgres lacks ALTER FK; drop + recreate is the only path. Both directions
-- of the linkage need this so a hard-purge of one side leaves the other side's
-- back-pointer NULL instead of failing the delete.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_converted_from_estimate_id_fkey;
ALTER TABLE invoices ADD CONSTRAINT invoices_converted_from_estimate_id_fkey
  FOREIGN KEY (converted_from_estimate_id) REFERENCES estimates(id) ON DELETE SET NULL;

ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_converted_to_invoice_id_fkey;
ALTER TABLE estimates ADD CONSTRAINT estimates_converted_to_invoice_id_fkey
  FOREIGN KEY (converted_to_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

-- 4. Widen contract_events.event_type CHECK.
-- Live list captured 2026-05-05 via pg_get_constraintdef:
--   17 existing values + 6 new ones for trash audit.
ALTER TABLE contract_events DROP CONSTRAINT contract_events_event_type_check;
ALTER TABLE contract_events ADD CONSTRAINT contract_events_event_type_check
  CHECK (event_type IN (
    'created','sent','email_delivered','email_opened','link_viewed',
    'signed','reminder_sent','voided','expired','paid','payment_failed',
    'refunded','partially_refunded','dispute_opened','dispute_closed',
    'estimate_sent','invoice_sent',
    'estimate_trashed','estimate_restored','estimate_purged',
    'invoice_trashed','invoice_restored','invoice_purged'
  ));

-- 5. convert_estimate_to_invoice RPC: filter trashed sources.
-- The RPC is defined in build67b. We CREATE OR REPLACE the body verbatim
-- with one extra `AND deleted_at IS NULL` on the source SELECT so trashed
-- estimates can never be silently converted from server code paths.
--
-- IMPORTANT: capture the live RPC body via
--   SELECT pg_get_functiondef('public.convert_estimate_to_invoice'::regproc);
-- and paste it below before adding the deleted_at filter on the source SELECT.
-- (See the build67b cleanup migration for the existing body shape.)
--
-- TODO during Step 2 implementation: paste the live function body here and
-- add the AND deleted_at IS NULL guard on the source-estimate SELECT only.
-- (Removing this TODO line is part of the task — do not commit with it
-- still present.)
```

**Note:** Step 1 leaves the RPC `CREATE OR REPLACE` as a marked TODO. Resolve it before commit:

- [ ] **Step 2: Capture the live RPC body and paste it into the migration**

Run via Supabase MCP `execute_sql`:

```sql
SELECT pg_get_functiondef('public.convert_estimate_to_invoice'::regproc);
```

Paste the returned function body into Section 5 of the migration file (after a `CREATE OR REPLACE FUNCTION public.convert_estimate_to_invoice(...) RETURNS … AS $function$` … `$function$` wrapper if `pg_get_functiondef` doesn't already supply one). Then locate the source-estimate `SELECT` (looks like `SELECT … FROM estimates WHERE id = p_estimate_id`) and add `AND deleted_at IS NULL` to its WHERE clause.

Remove the `TODO during Step 2 implementation` comment block — it must not be in the committed file.

- [ ] **Step 3: Verify the file is syntactically clean (Postgres dialect)**

Run no command — visual review the file. Confirm:
- All `ALTER`s end with `;`
- The RPC body has matched `BEGIN … END;` and matched `$function$` markers
- The CHECK list has trailing comma where needed and no trailing comma before the last value
- No leftover TODO/placeholder comments

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-build67d-soft-delete-estimates-invoices.sql
git commit -m "$(cat <<'EOF'
migration(67d): schema for soft-delete + 30-day trash on estimates and invoices

- estimates.deleted_at + delete_reason; invoices.deleted_at + delete_reason
- composite indexes on (organization_id, deleted_at) on both tables
- convert-linkage FKs flipped from NO ACTION to ON DELETE SET NULL
- contract_events.event_type CHECK widened with 6 new audit types
- convert_estimate_to_invoice RPC source-lookup gains AND deleted_at IS NULL

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3: Apply migration to prod via Supabase MCP

**Files:** none — DB-only.

- [ ] **Step 1: Apply the migration**

Run via Supabase MCP `apply_migration` with `name = "build67d_soft_delete_estimates_invoices"` and `query = <full content of the .sql file>`. (The MCP wraps in a transaction.)

Expected: success. If the FK drop+recreate fails because of existing rows that violate the new SET NULL semantics, abort — there shouldn't be any (SET NULL is permissive of existing rows), but flag if it does.

- [ ] **Step 2: Smoke-verify the schema applied**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN ('estimates','invoices')
  AND column_name IN ('deleted_at','delete_reason')
ORDER BY table_name, column_name;
```

Expected: 4 rows, all `is_nullable = YES`.

```sql
SELECT indexname FROM pg_indexes
WHERE tablename IN ('estimates','invoices')
  AND indexname LIKE 'idx_%_org_deleted_at';
```

Expected: 2 rows (`idx_estimates_org_deleted_at`, `idx_invoices_org_deleted_at`).

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN (
  'invoices_converted_from_estimate_id_fkey',
  'estimates_converted_to_invoice_id_fkey'
);
```

Expected: both definitions now contain `ON DELETE SET NULL`.

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint WHERE conname = 'contract_events_event_type_check';
```

Expected: 23 values (17 + 6), trailing 6 are `*_trashed/*_restored/*_purged`.

No commit on this task — DB state is the artifact.

---

## Phase 2 — TS types

### Task 4: Add `deleted_at` + `delete_reason` to TS interfaces

**Files:**
- Modify: `src/lib/types.ts:69-103, 536-574`

- [ ] **Step 1: Add the two fields to `Invoice` (around line 103)**

Find the existing block ending around line 103 (last fields in `Invoice` are `last_sent_at`, `last_sent_to_email`, etc.). Insert at the end of the interface body, before the closing `}`:

```ts
  deleted_at: string | null;
  delete_reason: string | null;
```

- [ ] **Step 2: Add the two fields to `Estimate` (around line 574)**

Same pattern at the end of the `Estimate` interface body (after `last_sent_to_email`).

```ts
  deleted_at: string | null;
  delete_reason: string | null;
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean (0 errors). The new fields are added to types but not yet referenced anywhere — adding optional null fields is non-breaking.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "$(cat <<'EOF'
types(67d): add deleted_at + delete_reason to Estimate and Invoice

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Helpers

### Task 5: Create `assertNotTrashed` route guard helper

**Files:**
- Create: `src/lib/api/assert-not-trashed.ts`

- [ ] **Step 1: Write the helper**

```ts
// Tiny gate used at every mutating route on a soft-deletable resource.
// Returns null if the row is active, or a 404 NextResponse if the row is
// trashed. Used as:
//
//   const trashed = assertNotTrashed(row);
//   if (trashed) return trashed;
//
// 404 (rather than 410 Gone) is intentional: it lets the existing auto-save
// retry/backoff handler treat trash as terminal-stop without a new branch.

import { NextResponse } from "next/server";

export function assertNotTrashed(
  row: { deleted_at: string | null } | null,
): NextResponse | null {
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.deleted_at !== null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return null;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/assert-not-trashed.ts
git commit -m "$(cat <<'EOF'
lib(67d): assertNotTrashed route guard for soft-deletable resources

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 6: Create shared document-purge helper

**Files:**
- Create: `src/lib/documents/purge.ts`

- [ ] **Step 1: Write the helper**

```ts
// Hard-purge cleanup for a single estimate or invoice: removes the canonical
// PDF (and any preset variants stored at the same path) from the `pdfs` bucket
// before the parent SQL delete cascades. Mirrors src/lib/jobs/purge.ts.
//
// Returns a result object the route can fold into its response — Storage
// errors do not block the row delete (build66 precedent: orphan storage is
// recoverable, half-deleted rows are not).

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-api";
import { estimatePdfPath, invoicePdfPath } from "@/lib/storage/paths";

export interface PurgeResult {
  storageRemoved: number;
  storageErrors: string[];
}

export async function purgeEstimateStorage(
  authedClient: SupabaseClient,
  estimateId: string,
): Promise<PurgeResult> {
  const { data: est } = await authedClient
    .from("estimates")
    .select("organization_id, job_id, estimate_number")
    .eq("id", estimateId)
    .maybeSingle<{
      organization_id: string;
      job_id: string;
      estimate_number: string;
    }>();
  if (!est) return { storageRemoved: 0, storageErrors: [] };

  const { data: job } = await authedClient
    .from("jobs")
    .select("job_number")
    .eq("id", est.job_id)
    .maybeSingle<{ job_number: string }>();
  if (!job?.job_number) return { storageRemoved: 0, storageErrors: ["job_number not found"] };

  const path = estimatePdfPath(est.organization_id, job.job_number, est.estimate_number);
  return removeFromPdfsBucket([path]);
}

export async function purgeInvoiceStorage(
  authedClient: SupabaseClient,
  invoiceId: string,
): Promise<PurgeResult> {
  const { data: inv } = await authedClient
    .from("invoices")
    .select("organization_id, job_id, invoice_number")
    .eq("id", invoiceId)
    .maybeSingle<{
      organization_id: string;
      job_id: string;
      invoice_number: string;
    }>();
  if (!inv) return { storageRemoved: 0, storageErrors: [] };

  const { data: job } = await authedClient
    .from("jobs")
    .select("job_number")
    .eq("id", inv.job_id)
    .maybeSingle<{ job_number: string }>();
  if (!job?.job_number) return { storageRemoved: 0, storageErrors: ["job_number not found"] };

  const path = invoicePdfPath(inv.organization_id, job.job_number, inv.invoice_number);
  return removeFromPdfsBucket([path]);
}

async function removeFromPdfsBucket(paths: string[]): Promise<PurgeResult> {
  if (paths.length === 0) return { storageRemoved: 0, storageErrors: [] };
  const service = createServiceClient();
  const { error } = await service.storage.from("pdfs").remove(paths);
  if (error) return { storageRemoved: 0, storageErrors: [error.message] };
  return { storageRemoved: paths.length, storageErrors: [] };
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/documents/purge.ts
git commit -m "$(cat <<'EOF'
lib(67d): purgeEstimateStorage + purgeInvoiceStorage helpers

Mirrors src/lib/jobs/purge.ts. Removes the canonical PDF from the pdfs
bucket via service-role; row-fetch via the authed client respects RLS.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — API routes (estimates side)

### Task 7: `POST /api/estimates/[id]/delete`

**Files:**
- Create: `src/app/api/estimates/[id]/delete/route.ts`

- [ ] **Step 1: Write the route**

```ts
// POST /api/estimates/[id]/delete — soft-delete an estimate (move to trash).
// Sets deleted_at = now() and delete_reason. The row stays in the DB and
// hides from active queries until either restored, hard-purged, or
// auto-purged after 30 days by GET /api/estimates/trash.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { apiDbError } from "@/lib/api-errors";

interface Body { delete_reason?: string }

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_estimates");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Body;
  const reason = body.delete_reason?.trim() || null;

  // Fetch context for the audit row before mutating.
  const { data: row } = await supabase
    .from("estimates")
    .select("id, organization_id, estimate_number, deleted_at")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      estimate_number: string;
      deleted_at: string | null;
    }>();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.deleted_at !== null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("estimates")
    .update({ deleted_at: now, delete_reason: reason })
    .eq("id", id)
    .is("deleted_at", null);
  if (updErr) return apiDbError(updErr.message, "POST /api/estimates/[id]/delete update");

  // Audit — best effort.
  const { data: { user } } = await supabase.auth.getUser();
  const { error: auditErr } = await supabase.from("contract_events").insert({
    organization_id: row.organization_id,
    contract_id: null,
    signer_id: null,
    event_type: "estimate_trashed",
    metadata: {
      estimate_id: row.id,
      estimate_number: row.estimate_number,
      delete_reason: reason,
      actor_email: user?.email ?? null,
      deleted_at: now,
    },
  });
  if (auditErr) console.warn("[api] estimate_trashed audit insert failed:", auditErr.message);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/estimates/[id]/delete/route.ts
git commit -m "$(cat <<'EOF'
api(67d): POST /api/estimates/[id]/delete (soft-delete to trash)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 8: `POST /api/estimates/[id]/restore`

**Files:**
- Create: `src/app/api/estimates/[id]/restore/route.ts`

- [ ] **Step 1: Write the route**

```ts
// POST /api/estimates/[id]/restore — pull an estimate back out of the trash.
// Clears deleted_at + delete_reason. Idempotent — already-active rows are
// no-ops and still write a (possibly redundant) audit row, which is fine.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { apiDbError } from "@/lib/api-errors";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_estimates");
  if (!gate.ok) return gate.response;

  const { data: row } = await supabase
    .from("estimates")
    .select("id, organization_id, estimate_number")
    .eq("id", id)
    .maybeSingle<{ id: string; organization_id: string; estimate_number: string }>();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error: updErr } = await supabase
    .from("estimates")
    .update({ deleted_at: null, delete_reason: null })
    .eq("id", id);
  if (updErr) return apiDbError(updErr.message, "POST /api/estimates/[id]/restore update");

  const { data: { user } } = await supabase.auth.getUser();
  const { error: auditErr } = await supabase.from("contract_events").insert({
    organization_id: row.organization_id,
    contract_id: null,
    signer_id: null,
    event_type: "estimate_restored",
    metadata: {
      estimate_id: row.id,
      estimate_number: row.estimate_number,
      actor_email: user?.email ?? null,
      restored_at: new Date().toISOString(),
    },
  });
  if (auditErr) console.warn("[api] estimate_restored audit insert failed:", auditErr.message);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/estimates/[id]/restore/route.ts
git commit -m "$(cat <<'EOF'
api(67d): POST /api/estimates/[id]/restore (restore from trash)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 9: `GET /api/estimates/trash` (lazy-purge + list)

**Files:**
- Create: `src/app/api/estimates/trash/route.ts`

- [ ] **Step 1: Write the route**

```ts
// GET /api/estimates/trash — list trashed estimates after first auto-purging
// anything that's been trashed for more than 30 days. Mirrors
// src/app/api/jobs/trash/route.ts.
//
// Optional ?job_id=<uuid> scopes both the lazy-purge and the list to a
// single job (used by the per-job EstimatesInvoicesSection toggle).

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { purgeEstimateStorage } from "@/lib/documents/purge";

const RETENTION_DAYS = 30;

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "view_estimates");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const jobId = url.searchParams.get("job_id");

  // 1. Find anything past the 30-day window.
  const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let expiredQuery = supabase
    .from("estimates")
    .select("id, organization_id, estimate_number")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoffIso);
  if (jobId) expiredQuery = expiredQuery.eq("job_id", jobId);
  const { data: expired } = await expiredQuery;

  // 2. Per row: write *_purged audit, run Storage cleanup, then DELETE.
  // One row at a time so a single failure doesn't strand the others.
  const { data: { user } } = await supabase.auth.getUser();
  const purgeFailures: { id: string; storageErrors: string[] }[] = [];
  for (const row of expired ?? []) {
    await supabase.from("contract_events").insert({
      organization_id: row.organization_id,
      contract_id: null,
      signer_id: null,
      event_type: "estimate_purged",
      metadata: {
        estimate_id: row.id,
        estimate_number: row.estimate_number,
        actor_email: user?.email ?? null,
        purged_at: new Date().toISOString(),
        reason: "auto_30d",
      },
    });
    const { storageErrors } = await purgeEstimateStorage(supabase, row.id);
    if (storageErrors.length > 0) purgeFailures.push({ id: row.id, storageErrors });
    await supabase.from("estimates").delete().eq("id", row.id);
  }

  // 3. List remaining trashed rows.
  let listQuery = supabase
    .from("estimates")
    .select("*, job:jobs!job_id(job_number, contact_id, contact:contacts(*))")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (jobId) listQuery = listQuery.eq("job_id", jobId);
  const { data: estimates, error } = await listQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    estimates: estimates ?? [],
    autoPurged: expired?.length ?? 0,
    purgeFailures,
    retentionDays: RETENTION_DAYS,
  });
}
```

- [ ] **Step 2: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/estimates/trash/route.ts
git commit -m "$(cat <<'EOF'
api(67d): GET /api/estimates/trash with lazy 30d auto-purge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 10: Replace `DELETE /api/estimates/[id]` with hard-purge

**Files:**
- Modify: `src/app/api/estimates/[id]/route.ts:71-92`

**Breaking change.** Today's `DELETE` does soft-void (`status='voided' + voided_at + void_reason`). After this task, it does hard-purge (Storage + DB delete). The only call site today is `src/components/job-detail/estimates-invoices-section.tsx:160` which is rewired in Task 19 to call the new soft-delete POST instead.

- [ ] **Step 1: Replace the DELETE handler body**

Read the current file first to confirm the line range. Replace the existing `export async function DELETE(...)` (currently lines 71–92) with:

```ts
export async function DELETE(
  _request: Request,
  ctx: RouteCtx,
) {
  // 67d: DELETE is now a hard-purge. Soft-delete (the trash flow) lives at
  // POST /api/estimates/[id]/delete.
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_estimates");
  if (!auth.ok) return auth.response;

  const { data: row } = await supabase
    .from("estimates")
    .select("id, organization_id, estimate_number")
    .eq("id", id)
    .maybeSingle<{ id: string; organization_id: string; estimate_number: string }>();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Audit row first — contract_events has no FK to estimates today, so it
  // would survive cascade either way, but writing first preserves audit on
  // any partial-failure path (Storage 4xx etc.).
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("contract_events").insert({
    organization_id: row.organization_id,
    contract_id: null,
    signer_id: null,
    event_type: "estimate_purged",
    metadata: {
      estimate_id: row.id,
      estimate_number: row.estimate_number,
      actor_email: user?.email ?? null,
      purged_at: new Date().toISOString(),
      reason: "force",
    },
  });

  const { storageRemoved, storageErrors } = await purgeEstimateStorage(supabase, id);

  const { error: deleteError } = await supabase.from("estimates").delete().eq("id", id);
  if (deleteError) {
    return apiDbError(deleteError.message, "DELETE /api/estimates/[id] purge", 500);
  }
  return NextResponse.json({ ok: true, storageRemoved, storageErrors });
}
```

Imports to add at top of file (insert after the existing `requirePermission` import):

```ts
import { purgeEstimateStorage } from "@/lib/documents/purge";
```

The old `getEstimateWithContents`, `checkSnapshot`, and `recalculateTotals` imports stay — they're used by GET/PUT in the same file.

- [ ] **Step 2: Update PUT to guard against trashed rows**

In the same file, find `export async function PUT(...)` (lines 37–69 currently). After the existing `await checkSnapshot(...)` call, before the `update` block, insert:

```ts
  // Block edits to trashed rows.
  const { data: trashedCheck } = await supabase
    .from("estimates")
    .select("deleted_at")
    .eq("id", id)
    .maybeSingle<{ deleted_at: string | null }>();
  if (trashedCheck?.deleted_at) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
```

(Could also use `assertNotTrashed` if the row was already fetched. The existing PUT relies on `checkSnapshot` which fetches `updated_at` only, so a separate small read is the cheapest path here.)

- [ ] **Step 3: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/estimates/[id]/route.ts
git commit -m "$(cat <<'EOF'
api(67d): DELETE /api/estimates/[id] is now hard-purge (was void)

Soft-delete moved to POST /api/estimates/[id]/delete. PUT also gains a
deleted_at guard so edits to trashed rows return 404.

BREAKING: only existing call site is the inline VoidConfirmDialog in
estimates-invoices-section.tsx (rewired to the soft-delete POST in a
later task).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — API routes (invoices side)

### Task 11: `POST /api/invoices/[id]/delete`

**Files:**
- Create: `src/app/api/invoices/[id]/delete/route.ts`

- [ ] **Step 1: Write the route — same shape as Task 7 but for invoices**

```ts
// POST /api/invoices/[id]/delete — soft-delete an invoice (move to trash).
// Mirror of POST /api/estimates/[id]/delete; see that file for design notes.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { apiDbError } from "@/lib/api-errors";

interface Body { delete_reason?: string }

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_invoices");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Body;
  const reason = body.delete_reason?.trim() || null;

  const { data: row } = await supabase
    .from("invoices")
    .select("id, organization_id, invoice_number, deleted_at")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      invoice_number: string;
      deleted_at: string | null;
    }>();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.deleted_at !== null) return NextResponse.json({ error: "not found" }, { status: 404 });

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("invoices")
    .update({ deleted_at: now, delete_reason: reason })
    .eq("id", id)
    .is("deleted_at", null);
  if (updErr) return apiDbError(updErr.message, "POST /api/invoices/[id]/delete update");

  const { data: { user } } = await supabase.auth.getUser();
  const { error: auditErr } = await supabase.from("contract_events").insert({
    organization_id: row.organization_id,
    contract_id: null,
    signer_id: null,
    event_type: "invoice_trashed",
    metadata: {
      invoice_id: row.id,
      invoice_number: row.invoice_number,
      delete_reason: reason,
      actor_email: user?.email ?? null,
      deleted_at: now,
    },
  });
  if (auditErr) console.warn("[api] invoice_trashed audit insert failed:", auditErr.message);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/invoices/[id]/delete/route.ts
git commit -m "$(cat <<'EOF'
api(67d): POST /api/invoices/[id]/delete (soft-delete to trash)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 12: `POST /api/invoices/[id]/restore`

**Files:**
- Create: `src/app/api/invoices/[id]/restore/route.ts`

- [ ] **Step 1: Write the route — Task 8 shape, swap estimate→invoice and `manage_estimates`→`manage_invoices`, event_type→`invoice_restored`. Show the full code below for clarity rather than referencing Task 8.**

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { apiDbError } from "@/lib/api-errors";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_invoices");
  if (!gate.ok) return gate.response;

  const { data: row } = await supabase
    .from("invoices")
    .select("id, organization_id, invoice_number")
    .eq("id", id)
    .maybeSingle<{ id: string; organization_id: string; invoice_number: string }>();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error: updErr } = await supabase
    .from("invoices")
    .update({ deleted_at: null, delete_reason: null })
    .eq("id", id);
  if (updErr) return apiDbError(updErr.message, "POST /api/invoices/[id]/restore update");

  const { data: { user } } = await supabase.auth.getUser();
  const { error: auditErr } = await supabase.from("contract_events").insert({
    organization_id: row.organization_id,
    contract_id: null,
    signer_id: null,
    event_type: "invoice_restored",
    metadata: {
      invoice_id: row.id,
      invoice_number: row.invoice_number,
      actor_email: user?.email ?? null,
      restored_at: new Date().toISOString(),
    },
  });
  if (auditErr) console.warn("[api] invoice_restored audit insert failed:", auditErr.message);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/invoices/[id]/restore/route.ts
git commit -m "$(cat <<'EOF'
api(67d): POST /api/invoices/[id]/restore (restore from trash)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 13: `GET /api/invoices/trash`

**Files:**
- Create: `src/app/api/invoices/trash/route.ts`

- [ ] **Step 1: Write the route — Task 9 shape, swap estimate→invoice everywhere. Full code below.**

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { purgeInvoiceStorage } from "@/lib/documents/purge";

const RETENTION_DAYS = 30;

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "view_invoices");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const jobId = url.searchParams.get("job_id");

  const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let expiredQuery = supabase
    .from("invoices")
    .select("id, organization_id, invoice_number")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoffIso);
  if (jobId) expiredQuery = expiredQuery.eq("job_id", jobId);
  const { data: expired } = await expiredQuery;

  const { data: { user } } = await supabase.auth.getUser();
  const purgeFailures: { id: string; storageErrors: string[] }[] = [];
  for (const row of expired ?? []) {
    await supabase.from("contract_events").insert({
      organization_id: row.organization_id,
      contract_id: null,
      signer_id: null,
      event_type: "invoice_purged",
      metadata: {
        invoice_id: row.id,
        invoice_number: row.invoice_number,
        actor_email: user?.email ?? null,
        purged_at: new Date().toISOString(),
        reason: "auto_30d",
      },
    });
    const { storageErrors } = await purgeInvoiceStorage(supabase, row.id);
    if (storageErrors.length > 0) purgeFailures.push({ id: row.id, storageErrors });
    await supabase.from("invoices").delete().eq("id", row.id);
  }

  let listQuery = supabase
    .from("invoices")
    .select("*, job:jobs!job_id(job_number, contact_id, contact:contacts(*))")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (jobId) listQuery = listQuery.eq("job_id", jobId);
  const { data: invoices, error } = await listQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    invoices: invoices ?? [],
    autoPurged: expired?.length ?? 0,
    purgeFailures,
    retentionDays: RETENTION_DAYS,
  });
}
```

- [ ] **Step 2: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/invoices/trash/route.ts
git commit -m "$(cat <<'EOF'
api(67d): GET /api/invoices/trash with lazy 30d auto-purge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 14: New `DELETE /api/invoices/[id]` (hard-purge)

**Files:**
- Modify: `src/app/api/invoices/[id]/route.ts`

Today the file has GET, PUT, and POST handlers but no DELETE. We add one that mirrors the estimates DELETE from Task 10.

- [ ] **Step 1: Add the DELETE handler at the end of the file**

```ts
export async function DELETE(
  _request: Request,
  ctx: RouteCtx,
) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_invoices");
  if (!auth.ok) return auth.response;

  const { data: row } = await supabase
    .from("invoices")
    .select("id, organization_id, invoice_number")
    .eq("id", id)
    .maybeSingle<{ id: string; organization_id: string; invoice_number: string }>();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("contract_events").insert({
    organization_id: row.organization_id,
    contract_id: null,
    signer_id: null,
    event_type: "invoice_purged",
    metadata: {
      invoice_id: row.id,
      invoice_number: row.invoice_number,
      actor_email: user?.email ?? null,
      purged_at: new Date().toISOString(),
      reason: "force",
    },
  });

  const { storageRemoved, storageErrors } = await purgeInvoiceStorage(supabase, id);

  const { error: deleteError } = await supabase.from("invoices").delete().eq("id", id);
  if (deleteError) {
    return apiDbError(deleteError.message, "DELETE /api/invoices/[id] purge", 500);
  }
  return NextResponse.json({ ok: true, storageRemoved, storageErrors });
}
```

Imports to add at top: `purgeInvoiceStorage` from `@/lib/documents/purge`. Confirm `RouteCtx`, `createServerSupabaseClient`, `requirePermission`, `apiDbError`, and `NextResponse` are already imported (they should be from existing handlers).

- [ ] **Step 2: Add deleted_at guard to PUT in the same file**

Locate the existing PUT handler. After the existing snapshot/auth fetches and before the update block, add:

```ts
  const { data: trashedCheck } = await supabase
    .from("invoices")
    .select("deleted_at")
    .eq("id", id)
    .maybeSingle<{ deleted_at: string | null }>();
  if (trashedCheck?.deleted_at) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
```

- [ ] **Step 3: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/invoices/[id]/route.ts
git commit -m "$(cat <<'EOF'
api(67d): DELETE /api/invoices/[id] hard-purge + PUT trashed guard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Apply trashed-row guards to existing mutating routes

### Task 15: Estimate mutating routes get `assertNotTrashed`

**Files:**
- Modify (each):
  - `src/app/api/estimates/[id]/send/route.ts` (and `…/preview/route.ts`)
  - `src/app/api/estimates/[id]/pdf/route.ts`
  - `src/app/api/estimates/[id]/convert/route.ts`
  - `src/app/api/estimates/[id]/sections/route.ts`
  - `src/app/api/estimates/[id]/sections/[section_id]/route.ts` if it exists
  - `src/app/api/estimates/[id]/line-items/route.ts`
  - `src/app/api/estimates/[id]/line-items/[item_id]/route.ts`
  - `src/app/api/estimates/[id]/status/route.ts`
  - `src/app/api/estimates/[id]/apply-template/route.ts`

Each route already fetches the parent estimate row early (search for `from("estimates")`). Add `, deleted_at` to the existing `select(...)` and call `assertNotTrashed(row)` immediately after.

- [ ] **Step 1: Walk each route and apply the pattern**

Pattern (illustrative — adapt to each route's existing select):

```ts
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";

// ... existing code that fetches the row ...
const { data: estimate } = await supabase
  .from("estimates")
  .select("status, deleted_at, /* existing fields */")
  .eq("id", id)
  .maybeSingle();
const trashed = assertNotTrashed(estimate);
if (trashed) return trashed;

// ... rest of the handler ...
```

For routes that don't currently fetch the row (e.g., `apply-template` may delegate to a helper), add a small fetch before the existing logic:

```ts
const { data: estimate } = await supabase
  .from("estimates")
  .select("deleted_at")
  .eq("id", id)
  .maybeSingle<{ deleted_at: string | null }>();
const trashed = assertNotTrashed(estimate);
if (trashed) return trashed;
```

For `send/preview/route.ts` specifically, the route already fetches the estimate (line 33 per grep). Splice the guard in the same spot.

For `convert/route.ts`, the guard goes on the **source estimate** (the `p_estimate_id` lookup). The destination invoice doesn't exist yet — only the source matters.

- [ ] **Step 2: Run typecheck after the full sweep**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/estimates/
git commit -m "$(cat <<'EOF'
api(67d): assertNotTrashed on every estimate mutating route

Send, send/preview, pdf, convert, sections, line-items, status,
apply-template — each fetches deleted_at along with its existing select
and 404s if non-null.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 16: Invoice mutating routes get `assertNotTrashed`

**Files:**
- Modify (each):
  - `src/app/api/invoices/[id]/send/route.ts` (and `…/preview/route.ts`)
  - `src/app/api/invoices/[id]/pdf/route.ts`
  - `src/app/api/invoices/[id]/sections/route.ts`
  - `src/app/api/invoices/[id]/sections/[section_id]/route.ts` if it exists
  - `src/app/api/invoices/[id]/line-items/route.ts`
  - `src/app/api/invoices/[id]/line-items/[item_id]/route.ts`
  - `src/app/api/invoices/[id]/status/route.ts` if it exists
  - `src/app/api/invoices/[id]/mark-sent/route.ts`
  - `src/app/api/invoices/[id]/void/route.ts`

- [ ] **Step 1: Apply the same pattern across each invoice route. Run typecheck.**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/invoices/
git commit -m "$(cat <<'EOF'
api(67d): assertNotTrashed on every invoice mutating route

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 — Active-list filters

### Task 17: Add `.is("deleted_at", null)` to active-list reads

**Files:**
- Modify: `src/app/api/estimates/route.ts:39, 68`
- Modify: `src/app/api/invoices/route.ts:25`
- Modify: `src/components/job-detail/estimates-invoices-section.tsx` (find the data-fetch site for active rows; likely a server-component parent or a useEffect)
- Modify: `src/app/invoices/page.tsx` (or its underlying server query / `invoice-list-client.tsx`)

Read-by-id endpoints (`GET /api/estimates/[id]`, `GET /api/invoices/[id]`) and the loaded helpers `getEstimateWithContents`/`getInvoice…` do **not** add the filter — read-only views need to render a banner over trashed rows.

- [ ] **Step 1: Walk each active-list site and add `.is("deleted_at", null)` to the existing select chain**

Example for `src/app/api/estimates/route.ts`:

```ts
// Before:
const { data, error } = await supabase
  .from("estimates")
  .select("…")
  .eq("organization_id", orgId);

// After:
const { data, error } = await supabase
  .from("estimates")
  .select("…")
  .eq("organization_id", orgId)
  .is("deleted_at", null);
```

For `estimates-invoices-section.tsx`, the data fetch may live in a server component that passes `estimates: Estimate[]` and `invoices: Invoice[]` as props. Trace upward — the filter goes wherever the active list is loaded (likely `src/app/jobs/[id]/page.tsx` or a colocated `lib/jobs/get-job-details.ts` or similar). When in doubt, grep for `from("estimates")` in `src/app/jobs/[id]/` and `src/components/job-detail/`.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Manual sanity check via dev server**

Skip the manual smoke test until UI tasks land — the current UI doesn't yet trigger trashing, so this filter is invisible. Just confirm tsc passes.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/estimates/route.ts src/app/api/invoices/route.ts src/app/jobs src/components/job-detail src/app/invoices src/components/invoices
git commit -m "$(cat <<'EOF'
api(67d): filter deleted_at IS NULL on active-list reads of
estimates and invoices

Read-by-id endpoints and loaded-fetch helpers intentionally NOT
filtered — read-only views need to render a banner over trashed rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8 — UI components

### Task 18: `<TrashConfirmDialog>` shared component

**Files:**
- Create: `src/components/trash/trash-confirm-dialog.tsx`

- [ ] **Step 1: Write the dialog**

```tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TrashConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentNumber: string;
  documentKind: "estimate" | "invoice";
  onConfirm: (reason: string | null) => Promise<void>;
  isTrashing: boolean;
}

export function TrashConfirmDialog({
  open,
  onOpenChange,
  documentNumber,
  documentKind,
  onConfirm,
  isTrashing,
}: TrashConfirmDialogProps) {
  const [reason, setReason] = useState("");

  async function handleConfirm() {
    const r = reason.trim() || null;
    await onConfirm(r);
    setReason("");
  }

  return (
    <Dialog open={open} onOpenChange={isTrashing ? undefined : onOpenChange}>
      <DialogContent showCloseButton={!isTrashing}>
        <DialogTitle>
          Move {documentKind} {documentNumber} to trash?
        </DialogTitle>
        <DialogDescription>
          It will be permanently deleted in 30 days. You can restore it before then.
        </DialogDescription>
        <div className="grid gap-2">
          <Label htmlFor="reason">Reason (optional)</Label>
          <Input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. duplicate, customer cancelled, …"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isTrashing) handleConfirm();
              if (e.key === "Escape" && !isTrashing) onOpenChange(false);
            }}
            disabled={isTrashing}
          />
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isTrashing}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isTrashing}
          >
            {isTrashing ? "Moving…" : "Move to Trash"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

If `Label` or `Input` aren't already in `src/components/ui/`, swap to whatever the codebase uses. Check existing dialogs (e.g., `src/components/job-detail/estimates-invoices-section.tsx` lines 35–114 — the inline VoidConfirmDialog) for the patterns this codebase prefers.

- [ ] **Step 2: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/trash/trash-confirm-dialog.tsx
git commit -m "$(cat <<'EOF'
ui(67d): TrashConfirmDialog shared component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 19: `<ForceDeleteConfirmDialog>` shared component

**Files:**
- Create: `src/components/trash/force-delete-confirm-dialog.tsx`

- [ ] **Step 1: Write the dialog**

```tsx
"use client";

import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ForceDeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentNumber: string;
  documentKind: "estimate" | "invoice";
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

export function ForceDeleteConfirmDialog({
  open,
  onOpenChange,
  documentNumber,
  documentKind,
  onConfirm,
  isDeleting,
}: ForceDeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={isDeleting ? undefined : onOpenChange}>
      <DialogContent showCloseButton={!isDeleting}>
        <DialogTitle>
          Permanently delete {documentKind} {documentNumber}?
        </DialogTitle>
        <DialogDescription>
          This cannot be undone. The PDF will also be removed from storage.
        </DialogDescription>
        <div className="flex justify-end gap-2 pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/trash/force-delete-confirm-dialog.tsx
git commit -m "$(cat <<'EOF'
ui(67d): ForceDeleteConfirmDialog shared component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 20: Replace Void with Trash in `<EstimatesInvoicesSection>`

**Files:**
- Modify: `src/components/job-detail/estimates-invoices-section.tsx`

This is the largest UI change. Three sub-edits.

- [ ] **Step 1: Remove the inline `<VoidConfirmDialog>` definition (lines 35–114) and its import callers**

Read the file. Delete the `function VoidConfirmDialog({...})` block. Delete the `voidTarget`/`isVoiding` state pair. Delete the `handleVoidConfirm` function (lines ~155–174).

- [ ] **Step 2: Add Trash state + handlers**

Near where the previous void state was, add:

```tsx
import { TrashConfirmDialog } from "@/components/trash/trash-confirm-dialog";
import { ForceDeleteConfirmDialog } from "@/components/trash/force-delete-confirm-dialog";

// ...inside the component, near the top of the body:
const [trashTarget, setTrashTarget] = useState<
  | { kind: "estimate"; row: Estimate }
  | { kind: "invoice"; row: Invoice }
  | null
>(null);
const [isTrashing, setIsTrashing] = useState(false);
const [forceTarget, setForceTarget] = useState<
  | { kind: "estimate"; row: Estimate }
  | { kind: "invoice"; row: Invoice }
  | null
>(null);
const [isForceDeleting, setIsForceDeleting] = useState(false);

async function handleTrashConfirm(reason: string | null) {
  if (!trashTarget || isTrashing) return;
  setIsTrashing(true);
  const url =
    trashTarget.kind === "estimate"
      ? `/api/estimates/${trashTarget.row.id}/delete`
      : `/api/invoices/${trashTarget.row.id}/delete`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete_reason: reason }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `Failed to move ${trashTarget.kind} to trash`);
      return;
    }
    const number =
      trashTarget.kind === "estimate"
        ? trashTarget.row.estimate_number
        : trashTarget.row.invoice_number;
    toast.success(`${capitalize(trashTarget.kind)} ${number} moved to trash`, {
      action: {
        label: "Undo",
        onClick: async () => {
          await fetch(
            trashTarget.kind === "estimate"
              ? `/api/estimates/${trashTarget.row.id}/restore`
              : `/api/invoices/${trashTarget.row.id}/restore`,
            { method: "POST" },
          );
          router.refresh();
        },
      },
    });
    setTrashTarget(null);
    router.refresh();
  } catch {
    toast.error(`Failed to move ${trashTarget.kind} to trash`);
  } finally {
    setIsTrashing(false);
  }
}

async function handleForceDelete() {
  if (!forceTarget || isForceDeleting) return;
  setIsForceDeleting(true);
  const url =
    forceTarget.kind === "estimate"
      ? `/api/estimates/${forceTarget.row.id}`
      : `/api/invoices/${forceTarget.row.id}`;
  try {
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `Failed to delete ${forceTarget.kind}`);
      return;
    }
    const number =
      forceTarget.kind === "estimate"
        ? forceTarget.row.estimate_number
        : forceTarget.row.invoice_number;
    toast.success(`${capitalize(forceTarget.kind)} ${number} permanently deleted`);
    setForceTarget(null);
    router.refresh();
  } catch {
    toast.error(`Failed to delete ${forceTarget.kind}`);
  } finally {
    setIsForceDeleting(false);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

If `useRouter` from `next/navigation` isn't already imported, add it. Same for `toast` from `sonner`.

- [ ] **Step 3: Replace the per-row "Void" link with "Trash"**

Find the existing per-row dropdown (lines ~287–309). Replace the void button:

```tsx
// Before:
{canEdit && est.status !== "voided" && est.status !== "converted" && (
  <button
    title="Void estimate"
    onClick={() => setVoidTarget(est)}
    className="…"
  >
    Void
  </button>
)}

// After:
{canManage && (
  <button
    title="Move estimate to trash"
    onClick={() => setTrashTarget({ kind: "estimate", row: est })}
    className="…"
  >
    Trash
  </button>
)}
```

`canManage` should be derived from `useAuth().hasPermission("manage_estimates")` (or whatever the codebase calls it). Same pattern for invoices, gating on `manage_invoices`.

Apply the matching change to the invoices half of the section if it has its own per-row buttons.

- [ ] **Step 4: Render the new dialogs at the bottom of the component**

Replace the existing `<VoidConfirmDialog … />` JSX (around line 327) with:

```tsx
<TrashConfirmDialog
  open={trashTarget !== null}
  onOpenChange={(open) => { if (!open) setTrashTarget(null); }}
  documentNumber={
    trashTarget?.kind === "estimate"
      ? trashTarget.row.estimate_number
      : trashTarget?.row.invoice_number ?? ""
  }
  documentKind={trashTarget?.kind ?? "estimate"}
  onConfirm={handleTrashConfirm}
  isTrashing={isTrashing}
/>
<ForceDeleteConfirmDialog
  open={forceTarget !== null}
  onOpenChange={(open) => { if (!open) setForceTarget(null); }}
  documentNumber={
    forceTarget?.kind === "estimate"
      ? forceTarget.row.estimate_number
      : forceTarget?.row.invoice_number ?? ""
  }
  documentKind={forceTarget?.kind ?? "estimate"}
  onConfirm={handleForceDelete}
  isDeleting={isForceDeleting}
/>
```

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean. If `useAuth` / `hasPermission` / etc. don't match this codebase's actual hook names, fix them. (Check `src/components/auth/auth-context.tsx` or wherever the auth hook lives.)

- [ ] **Step 6: Commit**

```bash
git add src/components/job-detail/estimates-invoices-section.tsx
git commit -m "$(cat <<'EOF'
ui(67d): replace inline VoidConfirmDialog with Trash + Force-delete

Trash any-status (per Q1). Toast includes Undo action that calls Restore.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 21: "Show trashed" toggle + trashed-row affordances on `<EstimatesInvoicesSection>`

**Files:**
- Modify: `src/components/job-detail/estimates-invoices-section.tsx` (continued from Task 20)

- [ ] **Step 1: Add a toggle state**

```tsx
const [showTrashed, setShowTrashed] = useState(false);
const [trashedEstimates, setTrashedEstimates] = useState<Estimate[]>([]);
const [trashedInvoices, setTrashedInvoices] = useState<Invoice[]>([]);

useEffect(() => {
  if (!showTrashed) {
    setTrashedEstimates([]);
    setTrashedInvoices([]);
    return;
  }
  let cancelled = false;
  Promise.all([
    fetch(`/api/estimates/trash?job_id=${jobId}`).then((r) => r.json()),
    fetch(`/api/invoices/trash?job_id=${jobId}`).then((r) => r.json()),
  ]).then(([est, inv]) => {
    if (cancelled) return;
    setTrashedEstimates((est?.estimates ?? []) as Estimate[]);
    setTrashedInvoices((inv?.invoices ?? []) as Invoice[]);
  });
  return () => { cancelled = true; };
}, [showTrashed, jobId]);
```

`jobId` comes from the existing component props.

- [ ] **Step 2: Render the toggle near the section header**

```tsx
<div className="flex items-center gap-2">
  <input
    id="show-trashed"
    type="checkbox"
    checked={showTrashed}
    onChange={(e) => setShowTrashed(e.target.checked)}
  />
  <label htmlFor="show-trashed" className="text-sm text-muted-foreground">
    Show trashed
  </label>
</div>
```

(Use the codebase's preferred Switch / Checkbox primitive if cleaner. Plain `<input>` works as a fallback.)

- [ ] **Step 3: Render trashed rows with muted styling + Restore + Delete now**

Below the active estimate rows, when `showTrashed` is true and there are trashed estimates, render a labeled subgroup:

```tsx
{showTrashed && trashedEstimates.length > 0 && (
  <>
    {trashedEstimates.map((est) => (
      <tr key={est.id} className="opacity-60 bg-muted/30">
        <td>{est.estimate_number}</td>
        {/* … other columns matching active rows … */}
        <td>
          <span className="text-xs text-muted-foreground">
            In trash · {daysLeft(est.deleted_at)} days left
          </span>
        </td>
        <td className="flex gap-1">
          <button
            className="text-blue-600 text-sm"
            onClick={() => restoreEstimate(est.id)}
          >
            Restore
          </button>
          <button
            className="text-red-600 text-sm"
            onClick={() => setForceTarget({ kind: "estimate", row: est })}
          >
            Delete now
          </button>
        </td>
      </tr>
    ))}
  </>
)}
```

`daysLeft` helper:

```tsx
function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return 0;
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  const remainingMs = 30 * 86_400_000 - elapsed;
  return Math.max(0, Math.floor(remainingMs / 86_400_000));
}
```

`restoreEstimate`:

```tsx
async function restoreEstimate(id: string) {
  const res = await fetch(`/api/estimates/${id}/restore`, { method: "POST" });
  if (!res.ok) {
    toast.error("Failed to restore estimate");
    return;
  }
  toast.success("Estimate restored");
  // Refresh both active list (server) and trashed list (client).
  router.refresh();
  setShowTrashed((v) => v); // re-trigger the effect by toggling cycle
  // Cleaner: refetch directly
  const tr = await fetch(`/api/estimates/trash?job_id=${jobId}`).then((r) => r.json());
  setTrashedEstimates((tr?.estimates ?? []) as Estimate[]);
}
```

Same shape for `restoreInvoice`. Render trashed invoices in a parallel block.

- [ ] **Step 4: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/job-detail/estimates-invoices-section.tsx
git commit -m "$(cat <<'EOF'
ui(67d): EstimatesInvoicesSection 'Show trashed' toggle + Restore/Delete-now

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 22: Trash filter chip on `/invoices` global list

**Files:**
- Modify: `src/components/invoices/invoice-list-client.tsx` (or wherever the `/invoices` page's filter UI lives — verify by reading the file first)

- [ ] **Step 1: Add a "Trash" status to the existing filter set**

Identify the filter pattern (usually an array of `{ value, label }` for status chips). Add `{ value: "trash", label: "Trash" }`.

```tsx
const filters = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  // …existing chips…
  { value: "trash", label: "Trash" },
];
```

When the user picks Trash, switch the data source from the active list query to `GET /api/invoices/trash` (no `job_id`).

```tsx
useEffect(() => {
  if (filter === "trash") {
    fetch("/api/invoices/trash")
      .then((r) => r.json())
      .then((j) => setRows(j.invoices ?? []));
    return;
  }
  // existing branch for active filters
}, [filter]);
```

- [ ] **Step 2: Render trashed rows with the same muted styling + Restore/Delete-now**

Reuse the visual pattern from Task 21. Hoist `daysLeft` to a small `src/lib/trash/days-left.ts` if you don't want it duplicated.

- [ ] **Step 3: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/invoices/invoice-list-client.tsx src/lib/trash 2>/dev/null
git commit -m "$(cat <<'EOF'
ui(67d): /invoices Trash filter chip + restore/delete-now actions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 23: Read-only view banners (estimates + invoices)

**Files:**
- Modify: `src/app/estimates/[id]/page.tsx`
- Modify: `src/app/invoices/[id]/page.tsx`
- Modify: any client components those pages render that own the action buttons (Send / Edit / Export PDF / Convert) — verify via `grep -rn "ExportPdfButton\|SendButton" src/app/estimates/[id]` etc.

- [ ] **Step 1: Add the trashed banner on the estimate read-only page**

In `src/app/estimates/[id]/page.tsx`, after fetching the estimate, branch on `deleted_at`:

```tsx
{estimate.deleted_at && (
  <TrashedBanner
    documentKind="estimate"
    documentId={estimate.id}
    documentNumber={estimate.estimate_number}
    deletedAt={estimate.deleted_at}
  />
)}
```

Action buttons (Edit, Send, Export PDF, Convert) wrap with `{!estimate.deleted_at && <…>}` or hoist into a `EstimateActions` component that no-ops when trashed.

- [ ] **Step 2: Create the shared banner component**

`src/components/trash/trashed-banner.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ForceDeleteConfirmDialog } from "@/components/trash/force-delete-confirm-dialog";

interface Props {
  documentKind: "estimate" | "invoice";
  documentId: string;
  documentNumber: string;
  deletedAt: string;
}

export function TrashedBanner({ documentKind, documentId, documentNumber, deletedAt }: Props) {
  const router = useRouter();
  const [forceOpen, setForceOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const purgeAt = new Date(new Date(deletedAt).getTime() + 30 * 86_400_000)
    .toLocaleDateString();

  async function restore() {
    setBusy(true);
    const res = await fetch(
      documentKind === "estimate"
        ? `/api/estimates/${documentId}/restore`
        : `/api/invoices/${documentId}/restore`,
      { method: "POST" },
    );
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to restore");
      return;
    }
    toast.success("Restored");
    router.refresh();
  }

  async function forceDelete() {
    setBusy(true);
    const res = await fetch(
      documentKind === "estimate"
        ? `/api/estimates/${documentId}`
        : `/api/invoices/${documentId}`,
      { method: "DELETE" },
    );
    setBusy(false);
    setForceOpen(false);
    if (!res.ok) {
      toast.error("Failed to delete");
      return;
    }
    toast.success(`${documentKind === "estimate" ? "Estimate" : "Invoice"} permanently deleted`);
    router.push(documentKind === "estimate" ? "/jobs" : "/invoices");
  }

  return (
    <>
      <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
        <span>
          This {documentKind} is in the trash. Auto-deletes on {purgeAt}.
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={restore} disabled={busy}>
            Restore
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setForceOpen(true)}
            disabled={busy}
          >
            Delete now
          </Button>
        </div>
      </div>
      <ForceDeleteConfirmDialog
        open={forceOpen}
        onOpenChange={setForceOpen}
        documentKind={documentKind}
        documentNumber={documentNumber}
        onConfirm={forceDelete}
        isDeleting={busy}
      />
    </>
  );
}
```

- [ ] **Step 3: Apply the same to the invoice read-only page**

Mirror the changes in `src/app/invoices/[id]/page.tsx`.

- [ ] **Step 4: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/trash/trashed-banner.tsx src/app/estimates/[id]/page.tsx src/app/invoices/[id]/page.tsx
git commit -m "$(cat <<'EOF'
ui(67d): TrashedBanner on read-only estimate + invoice views

Hides Edit/Send/Export/Convert action buttons while the doc is trashed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 24: Edit-page redirects when trashed

**Files:**
- Modify: `src/app/estimates/[id]/edit/page.tsx`
- Modify: `src/app/invoices/[id]/edit/page.tsx`

- [ ] **Step 1: Add the redirect for estimates**

At the top of the page component, after the existing fetch of the estimate, before rendering the builder:

```tsx
import { redirect } from "next/navigation";

// …after const estimate = await getEstimateWithContents(...)…
if (estimate?.estimate?.deleted_at) {
  redirect(`/estimates/${id}`);
}
```

(Adjust property access to match the actual return shape of `getEstimateWithContents`.)

- [ ] **Step 2: Same for invoices**

`src/app/invoices/[id]/edit/page.tsx`:

```tsx
if (invoice?.invoice?.deleted_at) {
  redirect(`/invoices/${id}`);
}
```

- [ ] **Step 3: Run typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/estimates/[id]/edit/page.tsx src/app/invoices/[id]/edit/page.tsx
git commit -m "$(cat <<'EOF'
ui(67d): edit pages redirect to read-only when doc is trashed

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9 — Verification

### Task 25: §11 manual test pass

**Files:** none (results doc + DB state).

Run the 12 tests from Section 11 of the spec, against prod Supabase Test Co workspace. Capture a results doc as 67c2 did.

- [ ] **Step 1: Reset / prepare fixtures**

If the 67c2 test fixtures (`WTR-2026-T67C2` job + 5 estimates A–E + 1 invoice) are still in Test Co, reuse them. Otherwise create fresh: a job, 3 draft estimates, 1 sent estimate, 1 voided estimate, 1 converted estimate + invoice, 1 paid invoice.

Confirm Eric is `admin` of Test Co before starting (`SELECT role FROM user_organizations WHERE user_id = … AND organization_id = '<test_co_org_id>'`).

Start the preview: `preview_start` per the project's preview-tool conventions.

- [ ] **Step 2: Execute Tests 1–12 from spec §11**

For each test, run the steps verbatim. Verify both UI behavior and DB state via direct SQL queries through Supabase MCP.

- [ ] **Step 3: Write results doc**

Create `docs/superpowers/specs/2026-05-05-build-67d-test-results.md` mirroring 67c2's results format. For each of the 12 tests: PASS/FAIL, evidence (DB row state, screenshots if useful, any inline fixes landed). Status badge at the top: `PARTIAL` until all 12 PASS, then `COMPLETE`.

- [ ] **Step 4: Land any inline fixes**

If a test fails and the fix is small (one or two lines), land it as a separate commit before moving on. Bigger fixes get logged in the results doc as findings F1, F2, etc., to land before code-reviewer.

- [ ] **Step 5: Commit results + any inline fixes**

```bash
git add docs/superpowers/specs/2026-05-05-build-67d-test-results.md src/  # whatever was touched
git commit -m "$(cat <<'EOF'
docs(67d): test results — 12/12 PASS

[summary of inline fixes if any]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 26: `superpowers:code-reviewer` pass

**Files:** none (review output drives code edits).

- [ ] **Step 1: Dispatch the reviewer over the 67d diff**

Invoke `superpowers:code-reviewer` agent against the commits from this build (range: from immediately after the 67c2 wrap commit `e8fec69` to the current HEAD). Provide the spec doc and this plan as references.

- [ ] **Step 2: Triage findings per Rule C**

Per the project's "Rule C" triage (00-glossary): **minor → log + proceed; material → stop + hand back.**

For Blockers and high-priority findings: land inline fixes immediately (mirror 67c2's M1/M2/Mn1 discipline). For lower-priority findings: log into the handoff as carry-over chips, do not block ship.

- [ ] **Step 3: Commit fix-now findings**

```bash
git add src/  # whatever was touched
git commit -m "$(cat <<'EOF'
fix(67d): code-review followups [list IDs and one-line each]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 27: One-off MCP cleanup of the 3 67c1 orphan PDFs

**Files:** none (Storage state only).

This was Q7 in the spec — out of scope for the build code, but the wrap session is the right time to do it.

- [ ] **Step 1: Confirm the 3 orphan paths still exist**

```sql
SELECT name FROM storage.objects
WHERE bucket_id = 'pdfs' AND name LIKE 'a0000000-%/WTR-2026-0018/%';
```

Expected: 3 rows for `EST-7.pdf`, `INV-2.pdf`, `INV-3.pdf` — or maybe fewer if any have been cleaned up another way.

- [ ] **Step 2: Decide which to keep + which to remove**

`EST-7` corresponds to a live estimate row (per 67c1 cleanup pass note in 00-NOW). Once 67d ships and Eric trashes EST-7 from the UI + the 30-day window expires, it'll auto-purge. Don't delete it manually.

`INV-2` and `INV-3` have no DB rows — these are the true orphans.

- [ ] **Step 3: Remove the two orphans via Storage API**

Use the Supabase MCP or a small one-shot script. From the JS console of an admin session OR from a tiny dev-only `node` script:

```ts
import { createServiceClient } from "@/lib/supabase-api";
const service = createServiceClient();
const { error } = await service.storage.from("pdfs").remove([
  "a0000000-XXXX-XXXX-XXXX-XXXXXXXXXXXX/WTR-2026-0018/INV-2.pdf",
  "a0000000-XXXX-XXXX-XXXX-XXXXXXXXXXXX/WTR-2026-0018/INV-3.pdf",
]);
console.log({ error });
```

(Replace `a0000000-…` with the real Test Co or AAA org id from the captured paths in Step 1.)

- [ ] **Step 4: Verify cleanup**

```sql
SELECT name FROM storage.objects
WHERE bucket_id = 'pdfs' AND name LIKE 'a0000000-%/WTR-2026-0018/%';
```

Expected: 1 row remaining (`EST-7.pdf`).

No commit on this task — it's pure Storage state cleanup.

---

## Self-review

After writing this plan, I checked it against the spec:

**1. Spec coverage:**
- §3 (status transitions) — covered by the schema delta + the absence of any status-mutation in the trash routes (Tasks 7, 8, 11, 12).
- §4 (deliverables) — every numbered item maps to one or more tasks: deliverable 1 → Tasks 1–3, deliverable 2 → Task 4, deliverable 3 → Tasks 5–17, deliverable 4 → Tasks 18–24, deliverable 5 → Task 25.
- §5 (API contract) — Tasks 7–14 cover the new routes; Tasks 15–16 cover the guards on existing routes; the convert RPC source filter lands in Task 2.
- §6 (audit payload) — covered by the `metadata` column writes in Tasks 7–14. **Note:** spec called this column `payload`; I used `metadata` here to match the actual codebase. This is a corrective — spec text was wrong about the column name.
- §7 (perm map) — Tasks 7–14 use `manage_*` for writes and `view_*` for reads.
- §8 (UI surfaces) — Tasks 18–24.
- §9 (edge cases) — 9.1 active-list filter → Task 17; 9.2 mutating-route guard → Tasks 15–16; 9.3 concurrent edit → covered implicitly by the 404-on-PUT in the guards; 9.4 convert → Task 2 RPC + Task 15; 9.5 race → comment in Task 9 prose; 9.6 storage failure → covered by purge helper return shape; 9.7 audit ordering → Task 1 Step 4 verified `contract_events` has no FK so ordering is moot (this updates the spec's assumption); 9.8 fidelity → schema-level (Q4 A); 9.9 self-check → Task 1; 9.10 out of scope → Task 27 covers the orphan cleanup separately.
- §11 (test plan) → Task 25.
- §12 (breaking change) → Task 10.

**2. Placeholder scan:** None. All "Step X" entries contain executable commands or full code blocks. The TODO marker in Task 2 Step 1 is explicitly resolved in Step 2.

**3. Type consistency:** `metadata` used consistently in audit-row inserts (Tasks 7, 8, 11, 12, 13, 14, plus the lazy-purge audit in Tasks 9, 13). Helper names (`purgeEstimateStorage`, `purgeInvoiceStorage`, `assertNotTrashed`) consistent across declaration (Tasks 5, 6) and consumers (Tasks 9, 10, 13, 14, 15, 16). `documentKind` prop name consistent across `<TrashConfirmDialog>` (Task 18), `<ForceDeleteConfirmDialog>` (Task 19), `<TrashedBanner>` (Task 23).

**4. Spec correction noted:** The spec §6 uses `payload` for the audit JSON column; the codebase uses `metadata` (verified at `src/app/api/estimates/[id]/send/route.ts:172`). The plan uses `metadata`. The spec doc is mildly wrong in §6 but the corrective is captured here — no separate fix needed.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-05-build-67d-soft-delete-estimates-invoices.md`. **Awaiting Eric's approval before starting code.** Two execution options when you're ready:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration with reviewer checkpoints (matches the discipline used for 67b's 52-task hybrid-B run and 67c1's T1–T17 SDD batch).

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for your review.

Which approach?
