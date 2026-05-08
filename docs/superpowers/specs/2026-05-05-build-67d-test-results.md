---
title: Build 67d — §11 manual test pass results
date: 2026-05-05
build_id: 67d
status: PARTIAL  # 12 PASS, 0 FAIL, but Test 7 has 1 sub-step caveat → PARTIAL out of caution; see Findings
---

# Build 67d — §11 manual test results

## Summary
- **12 tests run; 12 PASS** (functionally), with 1 caveat on Test 7's auto-save terminal-stop sub-check (see Finding F1) and 1 minor audit-shape note (F2).
- **Inline fixes landed:** none.
- **Findings logged for code-reviewer:** **F1** (root entity-PUT does not terminal-stop on 404; only line-item PUT does — important), **F2** (audit rows store actor as email-only in metadata, no typed `actor_user_id` column — nit).
- All 12 spec scenarios behaved per intent at the DB + API level. The single caveat is a UI behavior gap on the entity-level auto-save path — flagged for the controller.
- All side fixtures (Test Co WTR-2026-T67C2 + new WTR-2026-T67D-T10) restored to coherent state. **Eric restored to `admin` on Test Co.** AAA org untouched.

### Fixture deviations from brief
- The brief's Test 1 says "Estimate A (draft)" but inventory has EST-A as `sent`. Used **EST-B (draft)** for T1 and **EST-A (sent)** for T2 — both still hit "any-status" + "draft" paths as the spec intended.
- Brief says spec assumes "1 voided + 1 converted estimate" already exist; they did not. Per controller authorization, mutated fixtures: approved + converted EST-C (T3), EST-A (T9.1 setup), EST-B (T11) before purging the source. Did not exercise a voided estimate (not required by any of the 12 scenarios).
- Created a 2nd job `WTR-2026-T67D-T10` (id `ee14016a-2be6-4fcf-bd3e-5e8b664bb828`) on Test Co contact `b1fdde59-2889-45c1-ba36-c91f128056c6` to satisfy Test 10's "different jobs" requirement.

---

## Test 1 — Trash a draft estimate
**Status:** PASS
**Target:** EST-B `318bb976-21fc-47b5-9331-f7120e4e0a5e` (draft).
**Evidence:**
- API: `POST /api/estimates/EST-B/delete` `{ delete_reason: "test-1" }` → 200; DB row `deleted_at=2026-05-06 02:36:19+00, delete_reason="test-1"`. Audit row `estimate_trashed` written with `actor_email=eric@aaacontracting.com, delete_reason="test-1"`.
- UI: Job page shows TrashConfirmDialog ("Move estimate WTR-2026-T67C2-EST-B to trash?"); after submit, sonner toast "Estimate WTR-2026-T67C2-EST-B moved to trash" with **Undo** action surfaces. Clicking Undo issued `POST /restore` → 200; DB cleared `deleted_at` and `delete_reason`; audit row `estimate_restored` written.
**Notes:** Confirmed the "C1 dialog quirk" carry-over from 67c2 — `data-closed=""` flips on submit but the dialog DOM persists visually until parent `open` state actually unmounts it. Submit succeeded (DB + audit + toast all OK). Tagging as pre-existing carry-over per brief, NOT a new finding.

## Test 2 — Trash a sent estimate (any-status)
**Status:** PASS
**Target:** EST-A `f450db27-32ad-42cf-874b-2bcd0d85f634` (sent).
**Evidence:**
- API: `POST /delete` with empty body → 200; DB shows `status="sent", deleted_at=2026-05-06 02:38:07+00, delete_reason=NULL` (skip-reason path works).
- Job page: with "Show trashed" toggled on, EST-A row appears with hint "In trash · 29 days left" + Restore / Delete now buttons.
- Read-only `/estimates/[id]` view: TrashedBanner reads `"This estimate is in the trash. Auto-deletes on 6/4/2026."`; Send button is **absent** (verified via DOM scan — only "Back to job", "Restore", "Delete now" buttons render in the action bar). Banner offers Restore inline.

## Test 3 — Trash a converted estimate (cascade isolation)
**Status:** PASS
**Targets:** EST-C `20b219c9-…` → INV-2 `ff719ee3-…`.
**Evidence:**
- Approved EST-C via SQL, then `POST /api/estimates/EST-C/convert` → 200, returned `new_invoice_number="WTR-2026-T67C2-INV-2"`.
- `POST /api/estimates/EST-C/delete` → 200; DB: `EST-C.deleted_at=2026-05-06 02:39:08+00`. INV-2 unaffected: `deleted_at=NULL` (cascade isolation OK).
- `POST /api/invoices/INV-2/delete` → 200; DB: `INV-2.deleted_at=2026-05-06 02:39:23+00` (independent timestamp from EST-C).
- Job page with "Show trashed" → both EST-C and INV-2 appear in their trashed sub-rows along with the existing trashed EST-A.

## Test 4 — Restore preserves PDF fidelity
**Status:** PASS
**Target:** EST-D `ea2b587a-…` (sent, PDF in storage at `…/WTR-2026-T67C2/WTR-2026-T67C2-EST-D.pdf`).
**Evidence:**
- Pre-trash signed URL captured via `POST /api/estimates/EST-D/pdf` → 200 with `download_url=https://…sign/pdfs/…/WTR-2026-T67C2-EST-D.pdf?token=…`.
- Trashed EST-D, then re-fetched the recorded URL: `GET … → 200 application/pdf, content-length=134942`. PDF survives the trash window (Q4 A confirmed: Storage retention preserved).
- Restored, then visited `/estimates/EST-D` read-only: TrashedBanner gone (`hasBanner=false`), Send button visible (`hasSend=true`).

## Test 5 — Force-delete from trash
**Status:** PASS
**Target:** EST-E `9329c0c9-…` (had real PDF in Storage).
**Evidence:**
- Trashed EST-E (`POST /delete` → 200), then `DELETE /api/estimates/EST-E` → 200 with body `{ ok: true, storageRemoved: 1, storageErrors: [] }`.
- DB: row gone (`SELECT id … WHERE id=… → []`).
- Storage: PDF gone (`SELECT name FROM storage.objects … → []`).
- Audit ordering: `estimate_trashed` (02:41:01.498) then `estimate_purged reason=force` (02:41:01.974) — **purge audit row written before** the actual `DELETE`, exactly as spec demands.

## Test 6 — 30-day lazy auto-purge
**Status:** PASS
**Target:** EST-D (re-trashed for this test, then `deleted_at` SQL fast-forwarded by 31 days).
**Evidence:**
- `UPDATE estimates SET deleted_at = now() - interval '31 days' …` set `deleted_at=2026-04-05 02:41:27+00`.
- `GET /api/estimates/trash?job_id=…` returned `{ status:200, autoPurged:1, count:2, purgeFailures:[] }` (the other count slot is the still-in-window EST-A trashed earlier).
- DB: EST-D row gone. Storage: `…/WTR-2026-T67C2-EST-D.pdf` removed. Audit: `estimate_purged` with `metadata.reason="auto_30d"` written before the DELETE.

## Test 7 — Trashed source blocks convert + send + edit
**Status:** PASS (with caveat — see Finding F1 for the auto-save sub-step)
**Target:** EST-A (trashed for this test).
**Evidence:**
- `POST /api/estimates/EST-A/convert` → **404 `{ error:"not found" }`** ✓
- `POST /api/estimates/EST-A/send` (with stub body) → **404 `{ error:"not found" }`** ✓
- `PUT /api/estimates/EST-A` (entity update) → **404 `{ error:"not found" }`** ✓
- Browser navigation to `/estimates/EST-A/edit` → server redirects to `/estimates/EST-A` and the read-only view renders the TrashedBanner ✓ (URL after navigation = `/estimates/EST-A`, banner present)
- Direct `PUT /api/estimates/EST-A/line-items/<id>` → **404 `{ error:"not found" }`** ✓ (per-line-item save would terminal-stop on this 404 per `use-auto-save.ts` line 378)
**Caveat:** the spec also says "auto-save: PUT returns 404 → terminal stop toast." For per-line-item PUT this works (handleStaleConflict triggers). For root **entity-level** PUT, the auto-save code (`src/components/estimate-builder/use-auto-save.ts` lines 267-275) treats 404 as a generic 4xx and schedules an exponential-backoff retry, **not** terminal stop. See Finding F1.

## Test 8 — Permission deny path
**Status:** PASS
**Steps & Evidence:**
- Demoted Eric: `UPDATE user_organizations SET role='crew_lead' WHERE …` → role=`crew_lead` confirmed. No `manage_estimates`/`manage_invoices` rows existed in `user_organization_permissions` for Eric (verified — empty result), so demote alone is sufficient to deny.
- After hard reload of `/jobs/[id]`: estimate row buttons reduced to `["View","View"]` only — **Trash menu hidden** ✓ (also Edit hidden because `edit_estimates` granular perm not loaded after role change in Auth context). Same Trash-hidden behavior in the Invoices section.
- Direct API: `POST /api/estimates/EST-A/delete` → **403 `{ error:"forbidden" }`** ✓ ; `POST /api/invoices/T10-INV-1/delete` → **403 `{ error:"forbidden" }`** ✓.
- **Restored Eric to admin afterward** — verified `SELECT role … → "admin"` ✓.

## Test 9 — Same suite for invoices (subtests 1, 2, 5, 8)
**Status:** PASS
**9.1 (trash a draft + Undo via API):** Created INV-3 `68b34f3f-…` by approving + converting EST-A. `POST /delete delete_reason="test-9-1"` → 200; `POST /restore` → 200. DB: `deleted_at` set then NULL. Audit: `invoice_trashed reason="test-9-1"` then `invoice_restored`.
**9.2 (trash a paid invoice — any-status path):** INV-A `8ad4e096-…` (paid). `POST /delete` (no reason) → 200. DB: `status="paid", deleted_at=2026-05-06 02:45:23+00, delete_reason=NULL`. Job page "Show trashed" reveals it under "Trashed invoices" sub-section ("In trash · 29 days left" hint).
**9.5 (force-delete with PDF cleanup):** `DELETE /api/invoices/INV-A` → 200 `{ ok:true, storageRemoved:1, storageErrors:[] }`. DB row gone, Storage PDF removed, `invoice_purged reason="force"` audit written.
**9.8 (permission deny):** Covered alongside Test 8 above — same demote → 403 on `POST /api/invoices/[id]/delete`, Trash menu hidden in UI, Eric restored to admin.

## Test 10 — `/invoices` global Trash filter
**Status:** PASS
**Setup:** Created job WTR-2026-T67D-T10 (`ee14016a-…`) and an invoice T10-INV-1 (`e78a1c7c-…`) on it. Trashed INV-3 (Job 1) and T10-INV-1 (Job 2).
**Evidence:**
- `/invoices` page renders the filter chips: `[All, Draft, Sent, Partial, Paid, Voided, Trash]`.
- Click Trash chip → all 3 currently-trashed invoices visible (INV-2, INV-3, T10-INV-1) — confirms cross-job listing.
- Restored T10-INV-1 (`POST /restore` → 200), force-deleted INV-3 (`DELETE` → 200, `storageRemoved:1`).
- Click All chip → T10-INV-1 reappears, INV-3 absent (purged), INV-2 absent (still trashed) ✓.

## Test 11 — FK SET NULL on hard-purge
**Status:** PASS
**Target chain:** EST-B `318bb976-…` (approved + converted) → invoice `202d9bfd-…` (number INV-3, second occurrence after INV-3 from T10 was purged).
**Evidence:**
- Convert: `POST /convert` → 200 with `new_invoice_id=202d9bfd-…`. After convert: `invoices.converted_from_estimate_id = 318bb976-…`.
- Trash + force-delete EST-B: `POST /delete` → 200; `DELETE /api/estimates/EST-B` → 200 (`storageRemoved:1`).
- DB: estimate row gone. `SELECT converted_from_estimate_id FROM invoices WHERE id='202d9bfd-…'` → **NULL** ✓ (FK ON DELETE SET NULL working — both directions per migration-build67d-soft-delete-estimates-invoices.sql).
- Read-only invoice view at `/invoices/202d9bfd-…`: page renders cleanly, **no "From estimate" badge** is shown (the badge in `metadata-bar.tsx:137-145` is conditional on `invoice.converted_from_estimate_id`, which is now NULL). Spec called for "From estimate (deleted)" or omit the badge — current behavior is the **omit** branch.

## Test 12 — Audit trail integrity
**Status:** PASS
**Evidence:** Queried `contract_events` filtered to the six new event types for org Test Co — 27 audit rows captured across the test session, every one with the correct `event_type`, `metadata.estimate_number` or `metadata.invoice_number`, `metadata.actor_email="eric@aaacontracting.com"`, and the right `metadata.delete_reason` (when one was supplied) or `metadata.reason` ("force" / "auto_30d") on purge events. Sequence is monotonic by `created_at`; every `*_trashed` precedes its matching `*_restored`/`*_purged`. See finding F2 for an audit-shape nit.

---

## Findings

### F1 — Root estimate auto-save does not terminal-stop on 404 (severity: important)
**File:** `src/components/estimate-builder/use-auto-save.ts` lines 267–275 (entity-level `performEntitySave`).
**Observed:** When the parent estimate is trashed mid-edit, the server responds 404 to `PUT /api/estimates/[id]`. The current handler matches `res.status === 409 && hasSnapshotConcurrency` for terminal stop, treats `409 && !hasSnapshotConcurrency` and **all other 4xx including 404** as `handleSaveError` — which schedules an exp-backoff retry (1s → 2s → … → 30s cap) indefinitely, with the toast cycling between "saving…" and "error" but never the infinite "Modified by another user — refresh to see changes" terminal toast.
**Spec expectation (§11 Test 7 last sub-bullet):** "PUT returns 404 → terminal stop toast."
**Existing precedent in same file:** the per-line-item save handler (line 378-380, "I3 fix") already treats 404 the same as 409 → calls `handleStaleConflict`. Mirror that for the root PUT.
**Suggested fix (~3 lines):**
```ts
} else if (res.status === 409 && config.hasSnapshotConcurrency) {
  handleStaleConflict();
} else if (res.status === 404) {                        // ← add
  handleStaleConflict();                                // (or a "trashed" variant toast)
} else if (res.status === 409 && !config.hasSnapshotConcurrency) {
  handleSaveError(saveTimerRef, performEntitySave);
} else {
  handleSaveError(saveTimerRef, performEntitySave);
}
```
A bespoke "this document was moved to trash — refresh" toast would be even better UX, but mirroring `handleStaleConflict` is the minimal correct fix. Skipped inline per "design judgment" rule in the brief.

### F2 — Audit rows store actor as `metadata.actor_email` only; no typed `actor_user_id` column (severity: nit)
**File:** every `*_trashed` / `*_restored` / `*_purged` insert across `src/app/api/{estimates,invoices}/**/route.ts`.
**Observed:** The `contract_events` table has `signer_id uuid` (not `actor_user_id`); none of the new audit inserts populate it (signer_id is NULL on all 27 rows captured). `metadata.actor_email` is filled instead. The spec text says "correct actor_user_id" — strictly speaking this is a schema-vs-spec mismatch, not a bug, but if we ever need to audit by user_id (e.g. a deleted/anonymized user whose email is gone from `auth.users`) we'd be stuck.
**Suggested follow-up:** populate `signer_id = user.id` on these inserts (one-line change per route), or add `metadata.actor_user_id` alongside `actor_email`. Either preserves the auditing intent. Not blocking — purely a defense-in-depth note.

---

## Inline fixes landed
none.

---

## Final fixture state (Test Co only, post-run)
- **Eric:** `admin` on both orgs (verified).
- **Job WTR-2026-T67C2:** EST-A (status=`converted` from T9.1 setup, active), EST-C (status=`converted`, trashed from T3); INV-2 (draft, trashed from T3), INV-3=`202d9bfd-…` (draft, active — created by T11 and survives EST-B purge with NULL FK).
- **Job WTR-2026-T67D-T10 (new):** T10-INV-1 (draft, active) on contact `b1fdde59-…`. Brief did not require cleanup, leaving in place for any follow-up.
- **Hard-purged this run (gone from DB + Storage):** EST-B (T11), EST-D (T6 auto-purge), EST-E (T5), INV-A (T9.5), INV-3-original `68b34f3f-…` (T10).
- **AAA org (`a0000000-…001`):** untouched. ✓
