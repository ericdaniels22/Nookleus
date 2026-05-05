---
title: Build 67c2 — §11 Manual Test Results
date: 2026-05-04
build_id: 67c2
plan: docs/superpowers/plans/2026-05-04-build-67c2-send-via-email.md
status: PARTIAL — Tests 1–10 PASS, Tests 11–12 deferred to next session
---

# Build 67c2 — Manual Test Pass

Run against `d090216` on Claude Preview MCP dev server (Next.js dev) hitting prod Supabase (`rzzprgidqbnqcdupmpfe`).

Test org: **Test Company** (`a0000000-0000-4000-8000-000000000002`).
Send-from: `noreply@aaadisasterrecovery.com` (verified Resend domain).
Recipient (per Eric's call): `eric@aaacontracting.com` plus `+t<N>` aliases.
QB sub-assertions (Test 5, Test 6 no-fire): skipped per Eric ("let's not worry about quickbooks at the moment"). The `quickbooks_sync_status` column doesn't exist on `invoices` anyway.

## Results

| #  | Scenario                                 | Result        | Notes |
|---:|------------------------------------------|---------------|-------|
| 1  | Send draft estimate                      | **PASS**      | Toast `Sent to eric@aaacontracting.com`; DB `status=sent`, `sent_at`/`last_sent_at`/`last_sent_to_email` populated; audit row `event_type=estimate_sent` with `recipient`+`preset_id`+`message_id`+`provider`. Resend message_id `4d0474b3-3d89-4557-9681-3d26e77b4d7f`. |
| 2  | Re-send estimate to different recipient  | **PASS**      | `last_sent_to_email` advanced to `eric+t2@…`, `last_sent_at` updated, `sent_at` unchanged from Test 1, status still `sent`, new audit row written. |
| 3  | Send blocked from voided estimate        | **PASS**      | Send button `disabled=true` with tooltip `Cannot send a voided estimate.`; direct POST → `400 {"error":"cannot send a voided estimate"}`. |
| 4  | Send blocked from converted estimate     | **PASS**      | Same shape: tooltip `Cannot send a converted estimate.`; POST → `400 {"error":"cannot send a converted estimate"}`. |
| 5  | Send draft invoice                       | **PASS**      | Toast `Sent to eric@…`, `status=sent`, all timestamps populated, audit row `event_type=invoice_sent`. QB sub-assertion N/A per Eric. Resend message_id `76412701-c8ea-4e8a-98cf-ce5b92516a12`. |
| 6  | Re-send invoice from `paid`              | **PASS**      | After flipping invoice → `paid`: send succeeded; `last_sent_to_email`+`last_sent_at` advanced; `sent_at` unchanged; status remained `paid` (status-flip code only fires on `draft`); new audit row written. QB no-fire skipped per Eric. |
| 7  | Empty from-email empty-state             | **PASS**      | After nulling `send_from_email`, modal renders the empty-state copy `Configure your sending email first.` with link `Open Outgoing Emails settings →` to `/settings/payments`; Send button absent (only Cancel + Close present). Restored. |
| 8  | Job with no contact email                | **PASS**      | On the existing WTR-2026-0001 job (contact email NULL), Send modal opens with `to=""` (empty); manual entry of `eric+t8@…` accepted; send succeeded with status flip + audit row. |
| 9  | Permission gate (estimate + invoice)     | **PASS**      | After demoting Eric → `crew_lead` on Test Co (no `manage_estimates`/`manage_invoices` permission rows): SendButton returns `null` on both estimate and invoice pages (button absent); direct POST → `403 {"error":"forbidden"}` for both. Restored to `admin`. |
| 10 | Edit subject + body                      | **PASS**      | Sent with custom subject `TEST10-CUSTOM-SUBJECT-67c2` + custom body via the modal's editable Subject/Body fields; audit row recorded with `recipient=eric+t10@…`. (Email content verification = recipient inbox check, deferred to Eric.) |
| 11 | PDF render failure                       | **DEFERRED**  | Not run — paused before mutating `pdf_presets.document_type` to corrupt state. Use Estimate B (`318bb976-…`, draft, untouched) or Estimate C (`20b219c9-…`, draft, restored) for the rerun. |
| 12 | Resend / SMTP send failure               | **DEFERRED**  | Not run — paused before consuming Estimate E. Use Estimate E (`9329c0c9-…`, untouched draft) and recipient `bounce@simulator.amazonses.com`. |

## Inline fixes applied during the test pass

### Fix 1 — Merge-field syntax mismatch (caught at Test 1 step 1)

**Symptom:** Modal opened with subject reading literally `Estimate from {company_name} — {job_address}` and body still containing `{customer_first_name}`. The preview API returned `unresolvedFields: []` even though no merge fields were resolved.

**Root cause:** Plan-codebase divergence missed during T4. The plan's seeded templates used single-brace `{field}` syntax with field names `{job_address}` and `{customer_first_name}`. The existing `applyMergeFieldValues` helper in `src/lib/contracts/merge-fields.ts` only matches `{{double_brace}}` syntax (Tiptap pill or bare `{{token}}`). Single-brace strings flowed through unchanged AND fields like `job_address` / `customer_first_name` aren't in `MERGE_FIELDS`.

**Fix landed:**
1. `src/lib/contracts/merge-fields.ts` — added `customer_first_name` to `MERGE_FIELDS` and resolved it from `contact.first_name` inside `buildMergeFieldValues`. Two-line diff.
2. `supabase/migration-build67c2-send-via-email.sql` — rewrote both the backfill `UPDATE` block and the `seed_default_payment_email_settings` trigger function to use `{{double_brace}}` syntax with field names that exist (`{{customer_first_name}}`, `{{property_address}}`, `{{company_name}}`). Added a comment explaining the divergence.
3. **Live data:** Ran the corrected `UPDATE` against `payment_email_settings` for both AAA + Test Co. Issued `CREATE OR REPLACE FUNCTION public.seed_default_payment_email_settings(...)` so the trigger seeds future orgs with the corrected templates.
4. **Live setting:** Set `company_settings.value='Test Company'` for `key='company_name'` on Test Co (was empty); without this `{{company_name}}` would have rendered as the unresolved-blank span.

After the fix the preview API returned the fully-resolved subject + body, and Tests 1–10 ran clean against the resolved templates.

Commit landing the code + migration changes: see git history for the post-d090216 fix commit.

## Carry-overs

- **Modal does not visually close after successful send.** After `onOpenChange(false)` fires, base-ui's Dialog flips `data-closed` on the popup but `display: grid` / `visibility: visible` persist (no `tailwindcss-animate`-driven fade-out completes). Functional impact: state is still correct (modal open=false), but user has to click Cancel/X to dismiss. Likely a base-ui Dialog vs `data-closed:animate-out` interaction in this codebase. Worth chasing in a small follow-up — affects perceived UX of every successful send.
- **Tests 11 + 12 deferred.** Both require mutating shared state (Test 11 corrupts a preset's `document_type`; Test 12 sends to Resend's bounce simulator). Soft-landing skipped them rather than leaving cleanup half-done. Resume by following the §11 Test 11/12 steps verbatim; Estimate B/C/E are pristine drafts available.
- **Test fixtures left in DB.** Estimates A, D, T8 are now `sent`; Invoice A is now `paid`. Intentional — these are the fingerprints the tests created. `WTR-2026-T67C2*` job + 5 estimates + 1 invoice form a self-contained Test Co fixture set; the existing `WTR-2026-0001` job with NULL-email contact is preserved unmutated.
- **Resend delivery itself.** All 6 sends Resend accepted (returned message_ids). Eric to confirm physical email arrival in the `eric@aaacontracting.com` inbox + `+t<N>` aliases.

## Environment state at end-of-session

| Knob                                | State |
|-------------------------------------|-------|
| Eric's Test Co role                 | `admin` (restored) |
| Test Co `payment_email_settings.send_from_email` | `noreply@aaadisasterrecovery.com` (restored) |
| Test Co `company_settings.company_name` | `Test Company` (set during fix; harmless to leave) |
| `pdf_presets.document_type`         | All correct (`estimate` / `invoice`) — Test 11 not run |
| Live template content (both orgs)   | `{{double_brace}}` syntax with correct field names — fix is live |
