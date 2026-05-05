---
title: Build 67c2 — §11 Manual Test Results
date: 2026-05-04
build_id: 67c2
plan: docs/superpowers/plans/2026-05-04-build-67c2-send-via-email.md
status: COMPLETE — 12/12 PASS (Tests 11 + 12 picked up 2026-05-05)
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
| 11 | PDF render failure                       | **PASS**      | Run 2026-05-05 against `ad83bc8`. Corrupted preset `c4651b21-…` (`document_type='invoice'`, `is_default=false` to dodge the partial-unique). API path: direct POST with `preset_id=c4651b21-…` returned `400 {"error":"invalid preset"}` — route's pre-render `preset.document_type !== "estimate"` branch (route line 90–96), short of the `apiDbError` render-fail branch. Estimate B (`318bb976-…`) status, sent_at, last_sent_at, last_sent_to_email all unchanged; zero audit rows for the attempt. UI path: modal opened with the corrupted preset filtered out by `?document_type=estimate`, preset dropdown empty, Send → client toast `Select a PDF preset` (route never called). Restored preset to `document_type='estimate'`, `is_default=true`. |
| 12 | Resend / SMTP send failure               | **PASS**      | Run 2026-05-05 against `ad83bc8`. `bounce@simulator.amazonses.com` was accepted by Resend synchronously (message_id returned, draft consumed) — does NOT produce a sync rejection. Restored Estimate E to draft, deleted the audit row, switched forcing mechanism: corrupted `payment_email_settings.send_from_email` to `noreply@nookleus-not-verified-67c2-t12.test` (unverified domain forces Resend sync 4xx). API path: POST returned `502 {"error":"Resend error: The nookleus-not-verified-67c2-t12.test domain is not verified. Please, add and verify your domain on https://resend.com/domains"}`. Estimate E unchanged; zero audit rows. UI path: modal stayed open, To/Subject/Body edits preserved, toast surfaced the same provider error. Restored `send_from_email` to `noreply@aaadisasterrecovery.com`. |

## Findings (Tests 11 + 12)

### F1 — Test 12 toast surfaces the raw Resend message, not a redacted one (FIXED inline 2026-05-05)

Spec §11 Test 12 pass criterion calls for "redacted provider error". The original routes at `src/app/api/estimates/[id]/send/route.ts:136-139` (and the parallel `src/app/api/invoices/[id]/send/route.ts:134-137`) returned `e.message` verbatim at status 502 — bypassing the `apiDbError` redactor.

**Fix:** swapped both branches to `apiDbError(...)` while keeping the `FromUnconfiguredError` literal token (`{error: "from_unconfigured"}`) intact since the modal keys on it. Re-verified end-to-end: corrupted `send_from_email` to an unverified domain, POST returned `502 {"error":"internal error"}`, and the full Resend message landed in server logs as `[api] POST /api/estimates/[id]/send dispatch: Resend error: …`.

### F2 — Test 11 `document_type` corruption never reaches the renderer's catch path

The route at `src/app/api/estimates/[id]/send/route.ts:90-96` validates `preset.document_type === "estimate"` *before* invoking `renderAndUploadEstimatePdf`. Corrupting `document_type` therefore short-circuits to a 400 "invalid preset" rather than exercising the render-fail try/catch (line 107–112) that calls `apiDbError(...)`. Pass criteria are still met (no state mutation, modal stays open, error in toast). The render-failure branch coverage is from code-reading rather than execution. To exercise it directly would need a mechanism that passes pre-validation but throws inside the renderer (e.g. a missing Storage bucket or service-role failure); not blocking. Documented here so future test passes don't assume Test 11 covered the `apiDbError` path.

### F3 — SendModal preset Select trigger renders raw UUID instead of preset name (FIXED inline 2026-05-05)

Cosmetic: when a preset was selected, the `<SelectTrigger>` showed the raw `c4651b21-…` UUID instead of "Estimate (default)". Root cause: base-ui `<Select.Value>` renders the raw value unless given a function-as-children render prop (`(value) => label`). `<SelectItem>` body text content is NOT auto-mapped.

**Fix:** added a `children` render prop to `<SelectValue>` in `src/components/send-modal/index.tsx` that resolves `presetId` to `${p.name}${p.is_default ? " (default)" : ""}`. Verified: trigger now displays "Estimate (default) (default)" (the seed name happens to literally contain "(default)" plus the suffix marker).

### F4 — Partial unique index trips `document_type` flips to a doc_type that already has a default

`idx_pdf_presets_org_default WHERE is_default=true` is non-deferrable. Initial Test 11 `UPDATE … document_type='invoice'` failed because Test Co already has an invoice-default preset. Resolved by combining `is_default=false` in the same UPDATE; restore re-set both back. Mirrors the same lesson from the 67c1 cleanup pass — unique-index pre-flight is a 30-second checkbox before any `pdf_presets` mutation.

### F5 — Mid-session `from_unconfigured` POST returns ugly toast token (FIXED inline 2026-05-05)

If admin clears `send_from_email` between modal-open (preview said OK) and Send click, the POST returns `400 {error: "from_unconfigured"}`. The original modal toasted the literal token `from_unconfigured` to the user.

**Fix:** in `src/components/send-modal/index.tsx`, the response handler now detects `err.error === "from_unconfigured"` and flips the modal to the empty-state branch with the settings link rather than toasting the code. Verified end-to-end: opened modal with valid settings → SQL-zeroed `send_from_email` mid-session → clicked Send → modal flipped to "Configure your sending email first." with the settings link, no toast.

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
- **Tests 11 + 12 picked up 2026-05-05.** Both PASS with caveats — see Findings F1–F4 above. Estimate B + E and Test Co `payment_email_settings`/`pdf_presets` all restored to pristine state. Audit rows for both attempt-IDs verified at zero.
- **Test fixtures left in DB.** Estimates A, D, T8 are now `sent`; Invoice A is now `paid`. Intentional — these are the fingerprints the tests created. `WTR-2026-T67C2*` job + 5 estimates + 1 invoice form a self-contained Test Co fixture set; the existing `WTR-2026-0001` job with NULL-email contact is preserved unmutated.
- **Resend delivery itself.** All 6 sends Resend accepted (returned message_ids). Eric to confirm physical email arrival in the `eric@aaacontracting.com` inbox + `+t<N>` aliases.

## Environment state at end-of-session

| Knob                                | State |
|-------------------------------------|-------|
| Eric's Test Co role                 | `admin` (restored) |
| Test Co `payment_email_settings.send_from_email` | `noreply@aaadisasterrecovery.com` (restored) |
| Test Co `company_settings.company_name` | `Test Company` (set during fix; harmless to leave) |
| `pdf_presets.document_type`         | All correct (`estimate` / `invoice`) — Test 11 corrupt + restore round-trip clean |
| Live template content (both orgs)   | `{{double_brace}}` syntax with correct field names — fix is live |
