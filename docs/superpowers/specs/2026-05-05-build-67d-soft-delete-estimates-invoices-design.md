---
title: Build 67d — Soft-delete + 30-day trash for estimates and invoices
date: 2026-05-05
build_id: 67d
parent_build: 67
predecessor: 67c2
status: design — pending plan
---

# Build 67d — Design

Mirror of [[build-66]]'s soft-delete + 30-day trash pattern, applied to `estimates` and `invoices`. Replaces today's "Void" affordance on estimates with a unified Trash flow. Also unlocks the in-app cleanup path that the 67c1 cleanup pass was missing — orphan PDFs in the `pdfs` Storage bucket can now be removed via the same purge flow that drops the row, without the operator having to drop into SQL or MCP.

## 1. Goals & non-goals

### Goals

- A user with `manage_estimates` (or `manage_invoices`) can move any estimate (or invoice) to trash from the per-job table or the global invoice list, regardless of current status.
- Trashed rows hide from active queries but are recoverable for 30 days via Restore. After 30 days, lazy auto-purge (on next trash-list view) removes the row + its canonical PDF from Storage.
- A "Delete now" affordance on trashed rows skips the 30-day window and force-purges immediately.
- Restore preserves full fidelity — the canonical PDF stays in Storage during the trash window, so signed URLs already in flight (recent Send recipients) keep working through Restore.
- Every trash, restore, and purge writes a `contract_events` audit row capturing actor, reason, and document number (so audit survives the row delete).
- The existing FK back-pointers between estimates ↔ invoices (`converted_from_estimate_id`, `converted_to_invoice_id`) switch from `NO ACTION` to `ON DELETE SET NULL`, so independently trashing one side never blocks the other side's purge.

### Non-goals (deferred to later builds)

- **Cascade across the convert linkage.** Trashing an estimate does NOT trash its converted invoice (or vice versa). Per Q2, soft-delete is independent on each side.
- **Restoring `voided` rows into trash.** Existing voided estimates remain in their current `voided` status; users manually trash them via the new flow if they want them gone. No data migration of legacy voided rows.
- **A "Storage health" admin tool** that finds and removes Storage objects with no matching DB row. Considered as Q7 option B; deferred. The 3 existing 67c1 orphans (`a0…/WTR-2026-0018/{EST-7,INV-2,INV-3}.pdf`) are cleaned up via a separate one-off MCP call, not via build 67d code.
- **Real-time trash sync across tabs.** A user trashing in one tab while another tab edits the same doc relies on the next auto-save returning 404 → terminal stop. No WebSocket / live push.
- **Hardening every other unfiltered `/api` route against `deleted_at`.** Only routes that touch estimates and invoices are in scope.
- **Resurrection of trashed convert sources.** No "un-convert" UI. Convert remains one-way; trashing the source after a convert is allowed but the resulting invoice persists with a (now NULL after eventual purge) back-pointer.
- **A separate `delete_estimates` / `delete_invoices` permission key.** Q6 chose to reuse `manage_estimates` / `manage_invoices`. A future tenant that needs the bookkeeper-without-Send role can add new keys later.
- **Per-user soft-delete reason templates** or required-reason validation. The reason field is optional and free-form.

## 2. Decisions locked during brainstorm

| # | Decision | Choice |
|---|---|---|
| 1 | Status eligibility | **A** — any status (draft, sent, paid, voided, converted, …) can be trashed |
| 2 | Estimate ↔ invoice linkage on trash | **A** — independent (no cascade); FK switches to `ON DELETE SET NULL` for hard-purge safety |
| 3 | Trash UI placement | **A** — global `/invoices` Trash filter chip + per-job `<EstimatesInvoicesSection>` "Show trashed" toggle |
| 4 | PDF Storage cleanup timing | **A** — at hard-purge only (preserves Restore fidelity through the 30-day window) |
| 5 | Void vs Trash coexistence | **B** — Trash subsumes Void in the UI; `voided` status + `voided_at` + `void_reason` columns kept for legacy rows but never written by 67d code |
| 6 | Permission gate | **A** — reuse `manage_estimates` / `manage_invoices`; no new permission keys |
| 7 | Cleanup of existing 67c1 orphans | **A** — out of scope; one-off MCP `service.storage.from('pdfs').remove([...])` call separate from this build |

## 3. Status / state transitions

Soft-delete is orthogonal to status. The `deleted_at` column is independent of the `status` column. Status is unchanged by trash/restore.

| Action | `deleted_at` | `delete_reason` | Status | PDF in Storage |
|---|---|---|---|---|
| Trash any row | `now()` | user-supplied text or `NULL` | unchanged | retained |
| Restore a trashed row | `NULL` | `NULL` | unchanged | retained (no re-render) |
| Force-purge or 30-day auto-purge | row deleted | row deleted | row deleted (cascades) | removed via Storage API |

Mutating routes guard `deleted_at IS NOT NULL` → 404. Read routes return the row regardless (so trash UI can display it).

## 4. Deliverables

1. **Migration `supabase/migration-build67d-soft-delete-estimates-invoices.sql`**:
   - `ALTER TABLE estimates ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS delete_reason text`.
   - `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS delete_reason text`.
   - `CREATE INDEX IF NOT EXISTS idx_estimates_org_deleted_at ON estimates (organization_id, deleted_at)`.
   - `CREATE INDEX IF NOT EXISTS idx_invoices_org_deleted_at ON invoices (organization_id, deleted_at)`.
   - Drop + recreate FK constraints `invoices_converted_from_estimate_id_fkey` and `estimates_converted_to_invoice_id_fkey` with `ON DELETE SET NULL`.
   - Drop + recreate `contract_events_event_type_check` with the existing 17 values plus the 6 new ones (`estimate_trashed`, `estimate_restored`, `estimate_purged`, `invoice_trashed`, `invoice_restored`, `invoice_purged`).
   - **Pre-flight reminder:** capture the existing CHECK list via `pg_get_constraintdef` before drafting — same lesson as 67c2 §6 + 67c1 cleanup pass.
2. **Type updates** in `src/lib/types.ts` (or wherever `Estimate` / `Invoice` interfaces live): add `deleted_at: string | null` and `delete_reason: string | null` to both. Add `event_type` enum extension where it's mirrored in TS.
3. **API routes** (Section 5):
   - `POST /api/estimates/[id]/delete`, `POST /api/estimates/[id]/restore`, `GET /api/estimates/trash`, `DELETE /api/estimates/[id]` (hard-purge, replaces today's "void" semantics).
   - `POST /api/invoices/[id]/delete`, `POST /api/invoices/[id]/restore`, `GET /api/invoices/trash`, `DELETE /api/invoices/[id]` (new).
   - Storage purge helpers: `src/lib/estimates/purge.ts` + `src/lib/invoices/purge.ts` (or one shared `src/lib/documents/purge.ts`), each mirroring `src/lib/jobs/purge.ts`.
   - `assertNotTrashed(row)` tiny helper added to every existing PUT/POST that mutates an estimate or invoice (Send, PDF, Convert, line-items, sections, status). 404 if trashed.
   - `.is("deleted_at", null)` filter added to every read of `estimates` / `invoices` that powers an active list (per-job section, global `/invoices`, search, getEstimateWithContents). The trash GETs and read-by-id GETs do NOT add this filter.
4. **UI components**:
   - `<TrashConfirmDialog>` and `<ForceDeleteConfirmDialog>` in `src/components/job-detail/` (or a shared `src/components/trash/` if both surfaces import them).
   - Replace `<VoidConfirmDialog>` usage in `estimates-invoices-section.tsx` with `<TrashConfirmDialog>`. The `VoidConfirmDialog` is defined inline at the top of the section file (currently lines 35–114) and has no other call site — it's removed as part of the rewrite, no separate file to delete.
   - `<EstimatesInvoicesSection>` gets a "Show trashed" toggle and inline Restore + Delete now actions on trashed rows; muted styling and "N days left" hint.
   - `/invoices` list page (`src/app/invoices/page.tsx`) gets a Trash filter chip alongside its existing status chips. Same Restore / Delete now actions on trashed rows.
   - Read-only views (`/estimates/[id]/page.tsx`, `/invoices/[id]/page.tsx`) render a top-of-page banner when the doc is trashed; Edit, Send, Export PDF, and Convert buttons hide.
   - Edit pages (`/estimates/[id]/edit/page.tsx`, `/invoices/[id]/edit/page.tsx`) redirect to the read-only view if the doc is trashed.
   - Audit-row payload + `actor_email` capture so the trash list can show "trashed by …" without a JOIN to `auth.users`.
5. **Manual test pass per §11** running against prod Supabase (Test Co), executed from this build's session(s).

## 5. API contract

All routes scoped to `manage_*` for write actions, `view_*` for reads. All routes return JSON.

### `POST /api/estimates/[id]/delete` (and `/api/invoices/[id]/delete`)

Body: `{ delete_reason?: string }` (optional, free-form text).

Behavior:
1. `requirePermission(supabase, "manage_estimates")`.
2. Update `estimates` set `deleted_at = now()`, `delete_reason = body.delete_reason ?? NULL` where `id = $1 AND deleted_at IS NULL`. The `IS NULL` guard makes re-clicks idempotent.
3. Insert `contract_events` row with `event_type = 'estimate_trashed'`, payload as in §6.
4. Return `{ ok: true }`.

Error: 404 if row not found in caller's org or already trashed (rather than overwriting reason on second click).

### `POST /api/estimates/[id]/restore` (and `/api/invoices/[id]/restore`)

No body.

Behavior:
1. `requirePermission(supabase, "manage_estimates")`.
2. Update `estimates` set `deleted_at = NULL`, `delete_reason = NULL` where `id = $1`. Idempotent — already-active rows are no-ops.
3. Insert `contract_events` row with `event_type = 'estimate_restored'`.
4. Return `{ ok: true }`.

### `GET /api/estimates/trash` (and `/api/invoices/trash`)

Query params: `?job_id=<uuid>` (optional — scopes the list and the lazy-purge to a single job).

Behavior (matches `src/app/api/jobs/trash/route.ts` shape):
1. `requirePermission(supabase, "view_estimates")`.
2. Compute `cutoffIso = now() - 30 days`. Find rows where `deleted_at IS NOT NULL AND deleted_at < cutoffIso` (scoped to org; optionally to job_id).
3. For each expired row: write `*_purged` audit row, run `purgeEstimateStorage(supabase, id)` (or invoice), `DELETE FROM estimates WHERE id`. One row at a time so a single failure doesn't strand the others. Storage errors collected into `purgeFailures` and returned in the response; row delete proceeds regardless (build66 precedent).
4. List the remaining trashed rows (those with `deleted_at IS NOT NULL` but not yet expired), with the joined contact / job-number context the UI needs. Order by `deleted_at DESC`.
5. Return `{ estimates: [...], autoPurged: <int>, purgeFailures: [{id, errors[]}], retentionDays: 30 }` (or `{ invoices: [...], ... }` for the invoices route — matches build66's `{ jobs: [...], ... }` shape).

### `DELETE /api/estimates/[id]` (and `/api/invoices/[id]`)

Hard-purge. Replaces today's `DELETE /api/estimates/[id]` "void" semantics — see §11 breaking-change note.

Behavior:
1. `requirePermission(supabase, "manage_estimates")`.
2. Write `*_purged` audit row.
3. `purgeEstimateStorage(supabase, id)` removes the canonical PDF and any preset variants from `pdfs/{org}/{job}/{number}.pdf` via service-role Storage API.
4. `DELETE FROM estimates WHERE id`. FK cascades take `estimate_sections`, `estimate_line_items`, `contract_events` (where the parent FK cascades). The estimates ↔ invoices back-pointer FK now `SET NULL`.
5. Return `{ ok: true, storageRemoved: <int>, storageErrors: [...] }`.

### Trashed-row guards on existing routes

Every PUT/POST that mutates an estimate or invoice adds `if (row.deleted_at) return 404` immediately after the row fetch. Affected routes (non-exhaustive — plan will enumerate):

- `PUT /api/estimates/[id]` and `PUT /api/invoices/[id]`
- `POST /api/estimates/[id]/send` (and `/preview`); same for invoices
- `POST /api/estimates/[id]/pdf`; same for invoices
- `POST /api/estimates/[id]/convert`
- `POST /api/estimates/[id]/sections`, `POST /api/estimates/[id]/line-items`, `PUT` and `DELETE` on the same paths
- `POST /api/estimates/[id]/status`, `POST /api/estimates/[id]/apply-template`
- The same set on the invoices side, plus `POST /api/invoices/[id]/mark-sent` and `POST /api/invoices/[id]/void`

Read endpoints (`GET /api/estimates/[id]`, `GET /api/invoices/[id]`) return the row regardless of `deleted_at` so the read-only view banner can render.

`convert_estimate_to_invoice` RPC's source-estimate lookup adds `AND deleted_at IS NULL` so trashed estimates can't be silently converted from server code paths either.

## 6. Audit payload

Each `contract_events` row has the standard columns (`organization_id`, `actor_user_id`, `event_type`, `created_at`, plus the doc FK) and a `payload` JSON column with this shape:

```json
{
  "estimate_id": "uuid",
  "estimate_number": "EST-7",
  "delete_reason": "duplicate" | null,
  "actor_email": "eric@aaacontracting.com",
  "deleted_at": "2026-05-05T20:32:11.123Z"
}
```

(Same shape with `invoice_id` / `invoice_number` for invoice events.)

`estimate_number` and `actor_email` are captured at event time so the trash UI can render the audit row without joining to a possibly-purged parent or to `auth.users`. For `*_purged` events, the audit row is written **before** the parent DELETE so the cascade doesn't take it.

## 7. Permission map

| Action | Route | Gate |
|---|---|---|
| List active estimates / invoices | existing GETs (per-job section, `/invoices`, etc.) | `view_estimates` / `view_invoices` |
| List trash | `GET /api/{estimates,invoices}/trash` | `view_*` |
| Soft-delete | `POST .../delete` | `manage_*` |
| Restore | `POST .../restore` | `manage_*` |
| Hard-purge (Force or 30-day auto) | `DELETE /api/{estimates,invoices}/[id]` | `manage_*` |
| View trashed read-only page | existing `GET /api/{estimates,invoices}/[id]` | `view_*` (returns row even when trashed) |
| Edit / Send / PDF / Convert on a trashed row | existing routes | each route adds `assertNotTrashed(row)` before its own perm gate |

Crew-lead expectation: per `permissions-api.ts:44`, admin role short-circuits the perm check. To exercise the deny path during §11 testing, demote `user_organizations.role` to `crew_lead` AND revoke `manage_*`. Toggling the perm row alone is a no-op for admins. (Same pattern logged in [[2026-05-04-build-67c1-3]] Recently learned and reused for 67c2 testing.)

## 8. UI surfaces

### 8.1 Per-job `<EstimatesInvoicesSection>`

`src/components/job-detail/estimates-invoices-section.tsx` is the row-level menu the user interacts with most. Changes:

- **Remove** the existing per-row "Void" link and the `<VoidConfirmDialog>` inline component (currently defined at lines 35–114 of `estimates-invoices-section.tsx`; no separate file to delete since the dialog isn't extracted).
- **Add** a "Trash" action in the row dropdown for every status. Wires to `<TrashConfirmDialog>` → `POST /api/{estimates,invoices}/[id]/delete`.
- **Add** a "Show trashed" toggle (chip / switch) in the section header. Off by default. When on, refetch via `GET /api/estimates/trash?job_id=...` and `GET /api/invoices/trash?job_id=...` (parallel fetches; combined client-side) and interleave trashed rows with active ones, ordered most-recent-first.
- **Trashed rows** render with muted styling (`text-muted-foreground`, light background) plus a "In trash · N days left" hint computed from `deleted_at`. Inline actions on trashed rows: "Restore" (one click → POST → toast → refetch) and "Delete now" (opens `<ForceDeleteConfirmDialog>` → DELETE → toast → refetch).
- **`?job_id=...` query param** is the smallest delta on the trash GETs to keep the per-job view scoped. The global `/invoices` Trash filter omits it.

### 8.2 Global `/invoices` list

`src/app/invoices/page.tsx` (and its client component if any). Changes:

- **Add** a "Trash" filter chip alongside the existing status chips. Selecting it switches the data source from the active list query to `GET /api/invoices/trash` (no `job_id` filter — global).
- **Trashed rows** styled the same as in 8.1; same Restore + Delete now actions.
- **Lazy-purge** runs on the server the moment the user lands on the Trash filter (it's part of the `GET /trash` route). User sees a brief delay if many rows expire at once but otherwise no UI difference.

### 8.3 Read-only views

`src/app/estimates/[id]/page.tsx` and `src/app/invoices/[id]/page.tsx`. Changes:

- **Add** a top-of-page banner when `doc.deleted_at !== null`: "This {estimate|invoice} is in the trash. Auto-deletes on {deleted_at + 30d formatted}." with two buttons: "Restore" and "Delete now".
- **Hide** Edit, Send, Export PDF, and Convert buttons while the doc is trashed.
- **Side-effect** on the existing `getEstimateWithContents` / `getInvoiceWithContents` helpers: they currently return `null` if the row's not found. They'll be unchanged here; the read GET that powers SSR needs to be allowed to return a trashed row. Implementation note: the read helpers don't filter on `deleted_at` today (they fetch by id only), so no change needed — only the active-list helpers add the filter.

### 8.4 Edit pages

`src/app/estimates/[id]/edit/page.tsx` and `src/app/invoices/[id]/edit/page.tsx`. Changes:

- **Server-side check** at the top of the page component: if `doc.deleted_at !== null`, `redirect('/estimates/[id]')` (or invoices). No editing trashed rows. Avoids confusing auto-save 409 / 404 race conditions.

### 8.5 Trash-confirm dialog

`<TrashConfirmDialog>`. Props: `{ open, onOpenChange, documentNumber, documentKind: 'estimate'|'invoice', onConfirm(reason: string|null), isTrashing }`.

- Title: `"Move {kind} {NUMBER} to trash?"`
- Body: `"It will be permanently deleted in 30 days. You can restore it before then."`
- Optional reason field: single-line `<Input>`, no required validation.
- Buttons: `"Cancel"` and `"Move to Trash"` (red / destructive variant).
- On submit → `POST .../delete` with `{ delete_reason }`. Success toast `"{kind} moved to trash"` with an "Undo" action that calls `POST .../restore` and re-toasts on success.

### 8.6 Force-delete confirm dialog

`<ForceDeleteConfirmDialog>`. Used by the "Delete now" action on trashed rows.

- Title: `"Permanently delete {kind} {NUMBER}?"`
- Body: `"This cannot be undone. The PDF will also be removed from storage."`
- Buttons: `"Cancel"` and `"Delete permanently"` (red).
- No reason field; the original trash reason is preserved on the row through the brief in-trash interval.
- On submit → `DELETE .../[id]` → success toast → refetch.

## 9. Edge cases + cross-cutting concerns

### 9.1 Active-query filtering

Every existing read of `estimates` / `invoices` that powers an active list adds `.is("deleted_at", null)`. Plan will enumerate; rough sites:

- `src/components/job-detail/estimates-invoices-section.tsx`'s data fetch
- `src/app/invoices/page.tsx`'s list query
- `src/lib/estimates.ts` `getEstimatesForJob` (if exists; verify in plan write-up)
- `src/lib/invoices.ts` `getInvoicesForJob` (same)
- `convert_estimate_to_invoice` RPC's source lookup
- Any search / autocomplete that surfaces estimates or invoices

Read-by-id endpoints (`GET /api/{estimates,invoices}/[id]`), the read-only view SSR helpers, and the trash list endpoints do NOT filter — they intentionally return trashed rows.

### 9.2 Mutating-route guard

Every PUT/POST listed in §5 adds `assertNotTrashed(row)` immediately after the row fetch:

```ts
function assertNotTrashed(row: { deleted_at: string | null }): NextResponse | null {
  if (row.deleted_at !== null) return NextResponse.json({ error: "not found" }, { status: 404 });
  return null;
}
```

Used as `const trashed = assertNotTrashed(row); if (trashed) return trashed;` — same shape as the existing `requirePermission` gate.

Returning 404 (rather than 410 Gone) means the existing auto-save exp-backoff handler treats it as terminal-stop without a new branch.

### 9.3 Concurrent trash + active edit

User A trashes from the job page while user B is editing in another tab. B's next 2-second auto-save PUT hits 404 → terminal stop → toast "This estimate has been moved to trash." Same destructive-edit-from-elsewhere pattern as today's Void (which 409s on stale snapshot). No real-time push needed.

### 9.4 Convert from a trashed source

The `convert_estimate_to_invoice` RPC's source-estimate `SELECT` adds `AND deleted_at IS NULL`. The convert API route's pre-RPC validation also returns 404 if the source is trashed. Trashed estimates cannot be converted from any path.

If a user converts and then trashes the source estimate (independently allowed), the resulting invoice persists with `converted_from_estimate_id` still set. When the estimate is hard-purged, the FK `SET NULL` clears the back-pointer. The invoice's "From estimate EST-N" badge becomes "From estimate (deleted)" when it can't dereference. Render-side guard, no schema change beyond §4.

### 9.5 Lazy-purge race

Two simultaneous `GET /trash` callers might both try to purge the same expired row. The second `DELETE` is a no-op (`affected rows = 0`). Storage `.remove()` on an already-removed path returns success with empty data. Same race exists in build66's jobs trash and has been benign. Worth a comment in the route.

### 9.6 Storage failure during purge

Same as build66: collect into `purgeFailures` array, log, proceed with row delete. Orphan-PDF recovery path is the same one-off MCP call from §1 Q7.

### 9.7 Audit row ordering for purge events

`*_purged` audit rows are written **before** the parent DELETE. If the FK cascades `contract_events` from the parent (verify in plan write-up; existing 67c2 audit rows survive on the parent FK), the audit row would otherwise be dropped by cascade. Writing first preserves audit even on Storage-cleanup failure paths.

### 9.8 Restored doc fidelity

Per §2 Q4: the canonical PDF stays in Storage during the trash window. Restore sets `deleted_at = NULL` and the existing PDF (and any preset variants) is immediately viewable again — no re-render needed. Signed URLs already in flight (recipients who got the email seconds before the trash) keep working through Restore. This is the explicit win of "hard-purge only" over "soft-delete clears immediately."

### 9.9 Migration self-check

Before writing the migration:
1. Capture the existing `contract_events_event_type_check` allowed values via `pg_get_constraintdef('contract_events_event_type_check'::regclass)` against prod (current list as of 67c2: 17 values).
2. Capture the existing FK definitions via `pg_constraint` for `invoices_converted_from_estimate_id_fkey` and `estimates_converted_to_invoice_id_fkey` to confirm they're currently `NO ACTION` (verified during brainstorm: 00-NOW Recently learned entry on 67c1 cleanup confirms this).
3. Pre-flight run on a Supabase preview branch or local Supabase before applying to prod — same caution as 67c2.

### 9.10 Out of scope (explicit)

- The 3 67c1 orphan PDFs at `a0…/WTR-2026-0018/{EST-7,INV-2,INV-3}.pdf`. One-off MCP call: `service.storage.from('pdfs').remove([...])` after 67d ships.
- A general "Storage health" admin tool (Q7 option B). Future build if drift recurs.
- Auto-trash of legacy `voided` estimates. Existing voided rows stay as legacy data; user manually trashes if they want them gone.
- Hardening the rest of the ~80 unfiltered routes against `deleted_at` for tables this build doesn't touch.
- "Un-convert" / resurrection of trashed convert sources from inside an invoice context.

## 10. Tasks (rough sketch — full plan in writing-plans skill)

1. Capture current `contract_events_event_type_check` list + FK definitions; draft migration with exact lists.
2. Apply migration to prod via Supabase MCP.
3. Update TS types (`Estimate`, `Invoice`, audit event enum if mirrored in TS).
4. Build `src/lib/{estimates,invoices}/purge.ts` (or shared `documents/purge.ts`) — Storage cleanup helper.
5. New routes: `delete`, `restore`, `trash` for both estimates and invoices.
6. Replace `DELETE /api/estimates/[id]` body (was void; becomes hard-purge). Add `DELETE /api/invoices/[id]` (new).
7. Add `assertNotTrashed` helper. Wire it into every mutating route listed in §5.
8. Add `.is("deleted_at", null)` filter to every active-list read site listed in §9.1.
9. Update `convert_estimate_to_invoice` RPC to filter `deleted_at IS NULL` on source.
10. UI: `<TrashConfirmDialog>` + `<ForceDeleteConfirmDialog>`.
11. UI: replace Void usage in `<EstimatesInvoicesSection>`; add "Show trashed" toggle + Restore/Delete-now inline actions.
12. UI: add "Trash" filter chip to `/invoices` list page.
13. UI: read-only view banners + Edit-page redirects.
14. Remove the inline `<VoidConfirmDialog>` definition from `estimates-invoices-section.tsx` (no separate file to delete — it's defined inline today).
15. Update audit-row writes (6 new event types) wherever `contract_events` is inserted from new code.
16. §11 manual test pass (Section 11 of this spec).
17. `superpowers:code-reviewer` pass over the full diff (mirrors the discipline from 67c2's M1/M2/Mn1 fix-now landing); land any fix-now findings inline before handoff.

## 11. Manual test plan

Run against prod Supabase, Test Co workspace. Reuse the existing fixture `WTR-2026-T67C2` job + 5 estimates A–E + 1 invoice from 67c2 if still present, or create fresh.

### Test 1 — Trash a draft estimate
- Open job page; locate Estimate A (draft).
- Row dropdown → Trash → reason "test-1" → Move to Trash.
- Verify: row hides from active table; toast "Estimate moved to trash" with Undo. Click Undo → row reappears.
- DB: `deleted_at` was set then cleared; `delete_reason` was "test-1" then NULL. Audit rows `estimate_trashed` then `estimate_restored` written.

### Test 2 — Trash a sent estimate (any-status path)
- Trash Estimate B (status=sent). Skip reason field.
- Verify: row hides from active table. "Show trashed" toggle reveals it with "In trash · 30 days left" hint.
- Send button is hidden on the read-only view; trash banner renders instead.
- DB: `deleted_at` set; `delete_reason` NULL; audit row written.

### Test 3 — Trash a converted estimate (cascade isolation)
- Convert Estimate C → Invoice C2.
- Trash Estimate C. Verify Invoice C2 stays active (not cascaded).
- Trash Invoice C2 separately.
- Verify: both in trash, independent `deleted_at` timestamps. Job page table shows both with "Show trashed" on.

### Test 4 — Restore preserves PDF fidelity
- For a trashed estimate that had been Sent (PDF in Storage), record signed URL from prior Send.
- Restore from trash list.
- Click the recorded signed URL → PDF still loads (Q4 A — Storage retention through trash window).
- View the read-only page → no banner; Send button visible.

### Test 5 — Force-delete from trash
- Trash a fresh estimate. From "Show trashed" toggle on the job page, click "Delete now" → confirm.
- Verify: row gone from DB (`SELECT * FROM estimates WHERE id = ...` returns 0 rows). PDF gone from Storage (`SELECT * FROM storage.objects WHERE bucket_id = 'pdfs' AND name = '...'` returns 0). Audit row `estimate_purged` was written before the delete.

### Test 6 — 30-day lazy auto-purge
- SQL fast-forward: `UPDATE estimates SET deleted_at = now() - interval '31 days' WHERE id = '<test-id>'`. (Test-only; do not do this on real data.)
- Open the job page's "Show trashed" toggle → triggers `GET /api/estimates/trash` → lazy purge runs → row should be gone.
- Response payload includes `autoPurged: 1`.
- Storage cleared. Audit `estimate_purged` written.

### Test 7 — Trashed source blocks convert + send + edit
- Trash a draft estimate.
- Hit `POST /api/estimates/[id]/convert` directly via curl (or MCP) → expect 404.
- Hit `POST /api/estimates/[id]/send` → expect 404.
- Navigate to `/estimates/[id]/edit` → expect redirect to `/estimates/[id]` read-only.
- Auto-save: open edit before trashing in a separate session, trash from a different session, wait 2s for auto-save → PUT returns 404 → terminal stop toast.

### Test 8 — Permission deny path
- Demote Eric's `user_organizations.role` to `crew_lead` AND revoke `manage_estimates` for the Test Co membership.
- Reload job page; Trash menu item should be hidden.
- Direct curl to `POST /api/estimates/[id]/delete` → expect 403.
- Restore role + perm.

### Test 9 — Same suite for invoices (1, 2, 5, 8 only — paths are symmetric, no need to repeat all 7)
- Trash a draft invoice. Restore via Undo.
- Trash a paid invoice (any-status path). Verify "Show trashed" reveals it.
- Force-delete from trash. Storage + DB cleaned.
- Permission deny: demote + revoke `manage_invoices`. Verify Trash menu hidden.

### Test 10 — `/invoices` global Trash filter
- Trash 2 invoices on different jobs.
- Navigate to `/invoices`.
- Click "Trash" filter chip → list shows both. Restore one, force-delete the other.
- Filter chip back to "All" → only the restored invoice reappears.

### Test 11 — FK SET NULL on hard-purge
- Convert a draft estimate → invoice exists with `converted_from_estimate_id = <est_id>`.
- Trash the source estimate, then force-delete it.
- `SELECT converted_from_estimate_id FROM invoices WHERE id = '<inv_id>'` → returns NULL (FK SET NULL behavior).
- Read-only invoice view renders "From estimate (deleted)" or omits the badge.

### Test 12 — Audit trail integrity
- Across the prior tests, query `contract_events` for the affected estimate / invoice IDs.
- Verify each `*_trashed`, `*_restored`, `*_purged` event appears with the correct `actor_user_id`, captured `estimate_number` / `invoice_number`, and `delete_reason`.

## 12. Breaking-change call-out

`DELETE /api/estimates/[id]` semantics change:

- **Before 67d:** sets `status='voided' + voided_at + void_reason`. Row remains. UI dialog: `<VoidConfirmDialog>` with required reason. Used by `<EstimatesInvoicesSection>`.
- **After 67d:** hard-purges the row + Storage object. UI no longer surfaces this directly — the trash flow uses `POST .../delete` (soft-delete) and the "Delete now" action on trashed rows uses `DELETE .../[id]`.

Affected call sites: only `src/components/job-detail/estimates-invoices-section.tsx` calls `DELETE /api/estimates/[id]` today. The replacement wires through `<TrashConfirmDialog>` → `POST .../delete`. No external scripts or other call sites verified via grep during brainstorm.

The `voided` status enum value, `voided_at` column, and `void_reason` column on estimates remain in the schema for legacy rows; they're never written by 67d code. A future cleanup build can drop them once existing voided rows have been individually trashed by their owners (or auto-trashed by a one-off script if Eric chooses).

## 13. Pointers

- Predecessor handoff: [[2026-05-05-build-67c2-2]]
- Pattern reference: [[build-66]] + `supabase/migration-build66-soft-delete-jobs.sql`
- Build 66 implementation: `src/app/api/jobs/trash/route.ts`, `src/app/api/jobs/[id]/{delete,restore}/route.ts`, `src/app/api/jobs/[id]/route.ts` (DELETE), `src/lib/jobs/purge.ts`
- Storage path conventions: `src/lib/storage/paths.ts:76-81` (`estimatePdfPath`, `invoicePdfPath`)
- Existing void affordance to retire: `src/components/job-detail/estimates-invoices-section.tsx:35-114` (VoidConfirmDialog)
- Convention reminder: migrations are sequential + manual + not idempotent ([memory: project_migration_convention](.claude/projects/.../memory/project_migration_convention.md))
