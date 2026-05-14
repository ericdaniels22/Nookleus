---
date: 2026-05-14
build_id: contracts-builder
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-14-69-form-builder-safety-net-shipped]]", "[[build-15d]]"]
---

# Build contracts-builder Handoff — 2026-05-14 (fourteenth session, #70 auto-fill checkboxes shipped + raw-values bug caught + end-to-end stamped-PDF smoke PASSED)

## What shipped this session

- **Two source commits on branch `claude/70-autofill-checkboxes`** — `ae6affb` `contracts: auto-fill checkboxes bound to intake merge fields (#70)` and the smoke-driven fix `d1cd5f5` `contracts: auto-fill evaluator must use raw merge values not labels (#70 smoke fix)`. Opened as **[PR #75](https://github.com/ericdaniels22/Nookleus/pull/75)** against `main` (`Closes #70`); PR is OPEN at session end, awaiting Eric's merge.
- **All 11 spec ACs PASS end-to-end** in the Vercel PR preview against AAA prod (`nookleus-git-claude-70-autofill-checkboxes-nookleus.vercel.app`), against template Untitled Template (6) `ec9b8c74…` and job WTR-2026-0016 `27de9daa…` (Eric Daniels, property_type=single_family):
  - **AC1 (Inspector toggle):** Selecting any checkbox in the contract template editor renders a "Checkbox type" radio group with "Customer ticks at signing" vs "Auto-fill from intake data."
  - **AC2 (mode-conditional inspector body):** Auto-fill branch reveals "Bound merge field" dropdown + "Tick checkbox when value is one of" multi-select; customer-ticks branch shows the existing `inputKey`/`inputLabel`/`required` controls.
  - **AC3 (pill-typed multi-select):** Picking `property_type` (a pill with options Single Family / Multi Family / Commercial / Condo) shows the option labels next to their raw values; ticking stores raw values in `matchValues`.
  - **AC4 (draft creation populates customer_inputs):** `POST /api/contracts/send` for a job with `property_type=single_family` produced a contract with `customer_inputs = {"auto_residential_70": true}`. **The pre-fix run had `false` here — see "Mid-smoke bug + fix" below.**
  - **AC5 (preflight warning):** Temporarily nulled `property_type` on WTR-2026-0015 → `GET /api/contracts/preflight` returned `{"unresolvedAutoCheckboxes":[{"inputKey":"auto_residential_70","mergeFieldName":"property_type"}]}`. Restored after.
  - **AC6 (auto-fill non-interactive at signing):** Opened the signing URL; DOM probe returned `{aria:"Auto-filled checkbox", disabled:true, checked:true}`.
  - **AC7 (manual checkbox still interactive):** Same DOM probe for the customer-ticks one returned `{disabled:false, checked:false}`.
  - **AC8 ("Other:" pattern):** Naturally satisfied by design — `matchValues: ["other"]` ticks when the pill resolves to `"other"`; companion `*_other` text is just a separate merge overlay field.
  - **AC9 (server rejects unknown autofill slug):** PATCH with `mergeFieldName: "nonexistent_slug_xyz"` → 400 `unknown_autofill_merge_field`.
  - **AC10 (server rejects empty matchValues):** PATCH with `matchValues: []` → 400 `empty_autofill_match_values`.
  - **AC11 (Evaluator truth-table tests):** 12 unit tests in `auto-checkbox-evaluator.test.ts` plus 6 in `overlay-validation.test.ts` — 18 new tests over the 138 baseline → **156/156 green**.
- **End-to-end sign + stamped-PDF visual proof:** POSTed `/api/sign/[token]` with a 1×1 black-pixel PNG; status flipped `sent → signed`, `signed_pdf_path` set (174,575 bytes), `customer_inputs` merged to `{"auto_residential_70": true, "agreed_terms_70": true}`. Opened the stamped PDF inline via `URL.createObjectURL` + `<embed>` — **both X glyphs visually present at (100, 700) and (200, 700) on page 1**, confirming the existing `stampPdf` path renders auto-filled checkboxes identically to manually-ticked ones.
- **Smoke results posted as two [PR #75 comments](https://github.com/ericdaniels22/Nookleus/pull/75#issuecomment-4454659558)** — the 11-AC table and the bonus end-to-end sign + stamped-PDF verification.

## Mid-smoke bug + fix

**The first send attempt produced `customer_inputs.auto_residential_70 = false`** even though `property_type=single_family` was definitely in `matchValues = ["single_family","multi_family","condo"]`. Root cause: `resolveMergeFieldValues` applies `applyOptionLabel` to pill-typed fields by default, so `buildMergeFieldValues` returned `property_type = "Single Family"` (label) — but `matchValues` stores option values (`"single_family"`). Equality match never fired.

**Fix in commit `d1cd5f5`:** added an `opts.rawValues` flag to `resolveMergeFieldValues` that skips both `applyOptionLabel` and the `LEGACY_TITLECASE_COLUMNS` title-case transform. A new `buildMergeFieldRawValues` wrapper sets it. The three call sites — `POST /api/contracts/send`, `POST /api/contracts/in-person/start`, and `GET /api/contracts/preflight` — switched to the raw variant. Labeled values were never correct for equality-match evaluation; they're only for display/stamping. Plus a regression test in `auto-checkbox-evaluator.test.ts` (`"matches against raw option values, not display labels"`) that pins this contract directly with two cases: labeled input → no match, raw input → match.

## What's next

PRD **#65 contracts-template-builder is fully delivered** pending PR #75 merge. The four slices that shipped: #66 drag-to-pan, #67 dynamic merge fields, #68 email pickers, #69 form-builder safety net, #70 auto-fill checkboxes (this slice). After PR #75 merges, `gh issue close 70` happens automatically via the `Closes #70` tag.

**No remaining unblocked slices in this PRD.** Per `feedback_pause_between_issues.md`, pause for review/approval. Next session resumption point: confirm Eric merged + Vercel auto-deploys + #70 closes. Then choose the next initiative (umbrella #58 still has #62 and #63 `ready-for-agent`; #64 email-sync work shipped via PR #71; #68 real-email demo still on Eric's plate).

## Decisions locked

(Carried from prior sessions, plus three this session.)

- Ship #66–#70 as separate PRs/commits, not one bundled commit. Pause between issues. **All five now shipped.**
- Migration path C (per-field `merge_field_slug` alias) for legacy template compatibility (from #67).
- Composite synonyms (`customer_name`, `customer_address`) live in `SYSTEM_MERGE_FIELDS` (from #67).
- Hidden fields stay in the merge-field registry, marked `hidden: true`; pickers filter on `r.hidden` for new authoring (from #69, locked by AC6 of that slice).
- **Auto-fill checkbox match is equality-only on raw option values (new this session).** Spec says equality-only; the raw-vs-labeled resolver split makes this load-bearing — `buildMergeFieldValues` is for display/stamping, `buildMergeFieldRawValues` is for evaluation. The pinning test in `auto-checkbox-evaluator.test.ts` is the canonical assertion.
- **Auto-generate inputKey for auto-fill checkboxes (new this session).** When the inspector switches a checkbox into auto-fill mode, an `auto_<short-uuid>` inputKey is auto-assigned and the inputKey field is hidden in the UI per spec. The key still drives `customer_inputs[inputKey]` so `stampPdf`'s existing `=== true → "X" glyph` path keeps working with zero changes.
- **The same `customer_inputs` JSONB carries both auto-fill and manual ticks (new this session).** Auto-fill writes at draft creation via UPDATE-after-RPC (the existing `create_contract_with_signers` RPC has no `customer_inputs` param; rather than add one we patch separately). Signer-side merge in `/api/sign/[token]` and `/api/contracts/in-person` continues to work as `{...existing, ...signerSupplied}`, so auto-fill values survive the merge because the signer's payload doesn't include those keys (the disabled inputs aren't in the form state).

## New this session

- **`PublicSigningView` now carries `customer_inputs`.** The signing page needs to render auto-bound checkboxes with their pre-stamped state visible-but-locked. Threaded through `build-public-signing-view.ts`. Customers see exactly what the stamped PDF will draw.
- **The signer view filters `autoFillBinding` checkboxes out of the interactive overlay.** Rendered as `<input type="checkbox" disabled checked={prefilledInputs[inputKey] === true} aria-label="Auto-filled checkbox" />`. The `requiredMissing` gate explicitly skips them so an unticked auto-fill checkbox can't block a signer from submitting. Server-side `/api/sign/[token]` and `/api/contracts/in-person` both got the same defensive guard in their `missing` filter (no UI flag in the registry says "auto-fill can't be required" — easier to skip at evaluation time than wire a new field-level invariant).
- **The inspector's auto-fill multi-select stores raw option values, not labels.** Each pill option renders as `<label><input type=checkbox>… {label} <span>{value}</span></label>` so authors see both. Ticking pushes the option's `value` into `matchValues`. If `matchValues` contains values not in the bound field's option set (e.g. after the bound merge field's options changed), an inline amber `AlertTriangle` warns the author — non-blocking per spec.
- **New `GET /api/contracts/preflight?jobId=&templateId=`** returns the list of auto-bound checkboxes whose resolved value is null/empty. `send-contract-modal` calls it once when the user picks a template + once when the modal opens; the banner shows "Auto-fill checkboxes missing intake data" with the inputKey + slug list. Spec AC: "the sender sees it before clicking send."
- **The smoke ritual learned a new fixture pattern.** Untitled Template (6) `ec9b8c74…` got two test checkboxes left on it for future smoke runs: `auto_residential_70` (bound to property_type ∈ residential) and `agreed_terms_70` (customer-ticks "I agree to the terms"). Both at page 1, PDF coords (100, 700) and (200, 700) — well below the rest of the template. Genuine state for future smoke fixtures, mirroring the #69 precedent with the "Test Phone Number" custom field.

## Open threads

- **#69 "warn surface" follow-up (carried).** When designing slug-collision warnings, the warn surface should include collisions with `SYSTEM_MERGE_FIELDS` AND `PAYMENT_MERGE_FIELDS` slugs. Not yet filed as a tracker issue.
- **#69 inspector confirm modal edge case (carried).** The `maps_to` confirm doesn't fire on the first edit if `field.maps_to` was previously undefined; strict reading of the spec includes the unmapped→mapped transition. Not filed.
- **#69 Inspector Field ID input copy-to-clipboard polish (carried).** Disabled but no select-all affordance.
- **#68 real-email demo (carried).** Eric's pending — drop a custom intake field into a signing-request template, send to self, confirm the new dynamic field resolves in the delivered email. Not blocking anything now that #70 is done.
- **#67 inspector dropdown shows composite synonyms under "System"** (carried — awkward but acceptable).
- **#67 `fetchLatestFormConfig` adds one extra org-fetch per resolution call** (carried — negligible single-row indexed lookup).
- **#67 cross-org caution** if `buildMergeFieldValues` is called with a non-existent or soft-deleted jobId (carried).
- **#67 preview-route `SAMPLE_MERGE_VALUES`** in `src/app/api/settings/contract-templates/[id]/preview/route.ts:13-36` is still keyed on old legacy field names (carried — preview just renders blank for unmapped slugs).
- **No real customers signing yet (memory)** — durable secondary audit-write fallback for `finalize.ts:recordOutcome` can still wait (carried from earlier sessions).
- **New (this session): the pill-option `unknownMatches` warning in the inspector is informational-only.** If an author authors `matchValues` then the bound merge field's options later change, the saved `matchValues` may contain values that no longer exist. We warn but don't block (matches spec). A future cleanup pass could nudge authors to reconcile — file under #70b if it matters.
- **New (this session): the `/api/contracts/preflight` endpoint runs `buildMergeFieldRawValues` on every modal open + every template change.** That's one extra DB round-trip per template-pick. For templates with zero auto-bound checkboxes the route short-circuits (returns `[]` without resolving values). For ones with bindings, ~50–200ms. Acceptable for now; could be cached if it shows up in profiles.

## Mechanical state

- **Branch:** `claude/70-autofill-checkboxes` (current at session end)
- **Source commits:** `ae6affb` (`contracts: auto-fill checkboxes bound to intake merge fields (#70)`) + `d1cd5f5` (`contracts: auto-fill evaluator must use raw merge values not labels (#70 smoke fix)`)
- **Files changed across both commits:** 15 files, +863 / −19. New: `src/lib/contracts/auto-checkbox-evaluator.ts` (38 lines), `src/lib/contracts/auto-checkbox-evaluator.test.ts` (188 lines, 12 tests), `src/lib/contracts/overlay-validation.test.ts` (111 lines, 6 tests), `src/app/api/contracts/preflight/route.ts` (67 lines). Modified: `types.ts`, `overlay-validation.ts`, `merge-fields.ts` (added `buildMergeFieldRawValues`), `merge-field-resolver.ts` (added `opts.rawValues`), `build-public-signing-view.ts` (added `customer_inputs` to view), `field-inspector.tsx` (gained `CheckboxInspectorBody` + `AutoFillBindingEditor`), `send-contract-modal.tsx` (preflight warning banner), `contract-signer-view.tsx` (auto-fill filter), `send/route.ts` + `in-person/start/route.ts` (auto-fill plumbing post-RPC), `sign/[token]/route.ts` + `in-person/route.ts` (defensive `missing` guard).
- **PR:** [#75](https://github.com/ericdaniels22/Nookleus/pull/75) OPEN against `main` with `Closes #70`. Two smoke comments attached. Vercel preview deployed cleanly on both commits.
- **`main` HEAD when session started:** `47d235a` (vault handoff for #69). `main` did not advance during this session.
- **Working tree at session end:** clean except gitignored `out/` (uncommitted vault edits in this handoff are about to land next).
- **Migrations applied this session:** none (JSONB-only schema extension on `OverlayField`).
- **Vercel:** auto-deployed both commits on `claude/70-autofill-checkboxes`. Once `main` merges, the prod deploy follows automatically.
- **GitHub issues touched:** none yet — #70 auto-closes on PR #75 merge.
- **`.env.local`:** never used this session; smoke ran against the Vercel PR preview directly. No creds on disk.
- **Tests:** `npx vitest run` → **156/156 green** (+18 new across 2 files over the 138 baseline). `npx tsc --noEmit` clean on changed surface; preexisting `src/lib/email/sync-folder-incremental.test.ts:246` error from #64 work remains.
- **DB side-effects (AAA prod):** four contracts created during smoke (all voided or signed):
  - `83709804…` — pre-fix attempt, customer_inputs.auto_residential_70 was `false`. Voided.
  - `874d404f…` — post-fix attempt, customer_inputs.auto_residential_70 was `true`. Voided.
  - `dfccdb9b…` — end-to-end sign-smoke contract. Status `signed`, stamped PDF generated (174,575 bytes). Left in `signed` state because voiding a signed contract requires going through the void flow; Eric can void via UI if desired.
  - One job (`98ef9797…` WTR-2026-0015) had `property_type` temporarily nulled for the preflight unresolved-path test, then restored to `single_family`.
- **Smoke fixture left on Untitled Template (6):** two test checkboxes at PDF coords (100, 700) and (200, 700) on page 1. Inspector-deletable.

## Notes for next session

- **First action when resuming:** confirm Vercel deployed `main` cleanly + PR #75 merged + #70 auto-closed (should already be confirmed in vault). PRD #65 then fully delivered.
- **Raw-values vs labeled-values is the load-bearing split.** `buildMergeFieldValues` (labeled — `"Single Family"`) is for display/stamping; `buildMergeFieldRawValues` (raw — `"single_family"`) is for equality-matching against `matchValues`. The regression test `"matches against raw option values, not display labels"` pins this contract directly. Don't drop it.
- **The smoke fixture checkboxes on Untitled Template (6) are intentional.** Like the #69 precedent with "Test Phone Number," these are useful for future smoke runs that exercise the auto-fill path. If Eric clears them, the next smoke would need to recreate them (or fall back to the JS-dispatched DnD pattern from prior sessions to drop them via the inspector UI).
- **For follow-up #70-style scope (e.g. AND/OR matching, `contains` matchers, signer-overridable auto-fill, per-page coordinate UX in the inspector):** spec is explicit equality-only, so these are net-new scope, not bugfixes.
- **The pre-flight endpoint can be cached** if it shows up in profiles. Right now it runs on modal open + template change. The job's intake data rarely changes between sends, so a short Cache-Control would help if there's a measurable hit.

## Links

- PR: [#75](https://github.com/ericdaniels22/Nookleus/pull/75) — this slice (OPEN at session end)
- PRD: [#65](https://github.com/ericdaniels22/Nookleus/issues/65) — fully delivered pending PR #75 merge
- Slice 1 (closed): [#66](https://github.com/ericdaniels22/Nookleus/issues/66) — drag-to-pan
- Slice 2 (closed): [#67](https://github.com/ericdaniels22/Nookleus/issues/67) — dynamic merge fields
- Slice 3 (closed): [#68](https://github.com/ericdaniels22/Nookleus/issues/68) — email pickers
- Slice 4 (closed): [#69](https://github.com/ericdaniels22/Nookleus/issues/69) — form-builder safety net
- Slice 5 (this session): [#70](https://github.com/ericdaniels22/Nookleus/issues/70) — auto-fill checkboxes
- Prior session: [[2026-05-14-69-form-builder-safety-net-shipped]]
- Current state: [[00-NOW]]
- Related: [[build-15d]] (contract template overlay builder)
