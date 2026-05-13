---
date: 2026-05-13
build_id: contracts-builder
session_type: mixed
machine: Vanessas-MacBook-Pro.local
related: ["[[build-15d]]", "[[build-14j]]"]
---

# Build contracts-builder Handoff — 2026-05-13 (eighth session)

## What shipped this session

- **PRD #65 published** — "Contracts template builder: drag-to-pan, auto-checkboxes, and intake-derived merge fields" — labeled `ready-for-agent`. Covers three user-visible improvements that share infrastructure: (1) drag-to-pan when the PDF is zoomed, (2) auto-fill checkboxes bound to intake data, (3) dynamic merge fields auto-derived from the intake form config.
- **5 vertical slice issues published**, all labeled `ready-for-agent`:
  - **#66** Drag-to-pan in contract template builder PDF (no blocker)
  - **#67** Dynamic merge fields in contract template builder (no blocker; foundation slice — blocks 68/69/70)
  - **#68** Dynamic merge fields in email template editors (blocked by #67)
  - **#69** Form-builder safety net: id-lock, usage warnings, delete-blocking (blocked by #67)
  - **#70** Auto-fill checkboxes bound to intake-form merge fields (blocked by #67)
- **#67 partial implementation — `MergeFieldRegistryBuilder` module DONE with 9 passing tests via /tdd.** Not committed. Files in working tree:
  - `src/lib/contracts/merge-field-registry.ts` (new) — pure function `buildMergeFieldRegistry(formConfig, systemFields) → MergeFieldDefinition[]` with `MergeFieldSource` discriminated union (`{kind:"maps_to"|"job_custom_fields"|"system"}`). 31 lines.
  - `src/lib/contracts/merge-field-registry.test.ts` (new) — 9 tests: tracer bullet (one `maps_to` text field), legacy slug aliasing (`merge_field_slug` overrides `id`), pill option pass-through, hidden field exclusion (field-level `visible:false`), hidden section exclusion (section-level `visible:false`), `job_custom_fields` source for non-`maps_to` fields, system field appending, multi-section grouping, empty form_config + system-only.
  - `src/lib/types.ts` (modified) — `FormField` interface gained `merge_field_slug?: string` optional field (the only schema change for #67).
- No source commits. No migrations. No deploy.

## What's next

**Resume in fresh session on #67.** Remaining work per the issue body, in dependency order:

1. **`MergeFieldValueResolver` TDD loop** — refactor of `buildMergeFieldValues` to consume the registry instead of iterating the hardcoded `MERGE_FIELDS` array. Reuse the existing fake-Supabase pattern from `src/lib/contracts/__test-utils__/supabase-fake.ts` (used by void/restore/delete route tests). Needs to interpret `maps_to` strings like `"contact.first_name"` / `"job.property_type"` as cross-table joins through `job.contact_id`, handle `job_custom_fields` lookups by `field_key`, and dispatch system-source paths (date_today, company_settings key-value, adjuster from `job_adjusters` junction). Eric flagged this as the area where he might want eyes on the approach before tests pile up — recommend pausing to review the resolver interface design before the third TDD test.
2. **Refactor `merge-fields.ts`** to delegate to registry+resolver; delete `MERGE_FIELDS`, `mergeFieldsByCategory`, `isKnownField`. Keep `applyMergeFieldValues` and `resolveMergeFields` unchanged in shape (every consumer downstream of those — `email-merge-fields`, `payments/merge-fields`, `template-resolver`, `resolve-merge-values`, `stamp-pdf`, `finalize` — must keep working with no source changes).
3. **Update `overlay-validation.ts`** to validate `mergeFieldName` slugs against the registry instead of the static array.
4. **Wire registry into UI**: `field-palette.tsx` and `field-inspector.tsx` (merge type) consume the registry, grouped by intake form section + "System". Pill fields display option labels (not raw values).
5. **Server-side validation** on the contract-template PATCH endpoint (`src/app/api/settings/contract-templates/[id]/route.ts`) — reject saves with unknown merge slugs.
6. **Backfill the seeded `form_config`** with ~15 `merge_field_slug` entries to preserve legacy slugs that existing templates reference (`customer_first_name`, `damage_type`, `property_type`, `property_address`, `affected_areas`, `insurance_company`, `claim_number`, plus the contacts equivalents). One-time JSON edit; reversible.
7. **Manual demo** against a real job in AAA prod: add a custom intake field, reload contract template builder, drop it on a PDF, send the contract, verify the resolved value renders.

After #67 lands: per Eric's pause-between-issues rule, stop and review before kicking off #66, #68, #69, or #70. **#66 (drag-to-pan) is the natural follow-up** — independent of #67, small, mergeable as its own PR, good warm-up. #68/#69/#70 unblock after #67.

## Decisions locked

These are decisions Eric **explicitly confirmed** during the `/grill-me` walk-through and the `/to-prd` / `/to-issues` plan-approval steps:

- **Ship all three improvements together** (Eric: "lets just do them all together"). Splitting into 2 PRs (drag-to-pan separate from the merge-field refactor + auto-checkbox bundle) was floated as a recommendation but Eric did not pick a side.
- **Custom merge fields = auto-derived from intake form** — the intake form builder IS the merge-field admin UI. Adding a field to intake automatically exposes it as a merge field on contracts AND every email template. No opt-in toggle per field (Eric: "yes those three" approving Registry/Resolver/Evaluator tests, prior to which he agreed with auto-expose).
- **Auto-checkbox binding model**: each auto-bound checkbox stores `autoFillBinding: { mergeFieldName: string; matchValues: string[] }`. Equality matching only — many-to-one (one checkbox ticks for several intake values) is supported via the array. No AND/OR/contains. (Eric: "sounds good")
- **Auto-checkboxes are LOCKED at signing time** — the signer cannot toggle them (Eric: "a"). Auto-evaluation happens at draft creation; contracts are frozen at send time.
- **Missing intake data**: auto-checkboxes default to unchecked + surfaced in the existing `unresolvedFields` warning pipeline. (Eric: "yes keep going")
- **Drag-to-pan trigger**: click-and-drag on empty PDF area only. No spacebar variant, no toolbar toggle button. Scrollbars + trackpad scroll continue to work as fallbacks. (Eric: "a only")
- **Migration path C**: keep both names. Each form_config field gets an optional `merge_field_slug` that aliases its internal `id` to a legacy merge slug; this preserves existing templates without renaming intake field IDs. ~15 fields need backfilling. (Eric: "i will take your reccomendation")
- **Pause between issues**: when working a multi-issue plan, stop after each issue is complete to review and approve the next. Saved as a feedback memory at `feedback_pause_between_issues.md`. (Eric: "lets pause after each issue is complete to review and approve start of the next issue")
- **Test coverage for the three pure modules** — Registry, Resolver, Evaluator. Skip TemplateReferenceLookup (DB query, manual test) and PdfPanController (UI, smoke test). (Eric: "yes those three")
- **Tracer-bullet test plan for `MergeFieldRegistryBuilder`** approved: 8 behaviors in priority order — legacy slug aliasing first because it's most likely to silently break live templates. Actual implementation hit 9 tests (split hidden-field into field-level + section-level cases). (Eric: "yes to everything")

## Open threads

- **Resolver design needs review before the TDD loop continues.** The existing `buildMergeFieldValues` resolves through hardcoded paths — `job.contact_id` → contacts table, `job_adjusters` junction → primary adjuster, `company_settings` key-value store, etc. The refactored resolver needs to interpret `maps_to` strings (e.g., `"contact.first_name"` means "join contacts via job.contact_id, return first_name column") generically. Before writing the second resolver test, walk Eric through the resolution-source dispatch design. Risks: legacy slug aliasing must produce identical values to today's hardcoded paths or live contracts will regress.
- **Backfill JSON edit to `form_config` is risk-bearing.** The seeded `form_config` row is the source of truth for production intake. Editing it to add ~15 `merge_field_slug` entries should be tested against AAA prod's actual current form_config (might have diverged from the seed). Per memory `feedback_supabase_mcp_prod_migration_approval.md`, surface the change and ask "yes apply" before pushing to prod.
- **Validation coverage in #67 is server-side only.** The client-side picker won't enforce slug existence — if the registry is fetched async and a stale picker submits a removed slug, the save fails with a generic message. Should improve picker freshness or surface a clearer client-side warning. Not blocking; logged for #69's safety-net work.
- **`overlay-validation.ts` callers** — at least one consumer currently uses the static `MERGE_FIELDS` array directly. Will need to thread the registry through or fetch it inside the validator. Decide approach when starting that refactor step.
- **Drag-to-pan (#66) interaction with HTML5 native drag-and-drop.** The page wrapper already handles `onDragOver` / `onDrop` for placing new fields from the palette. The new pan controller's `onMouseDown` must not intercept those events. Specifically: mouse events fire on mousedown; HTML5 drag events only fire after the user drags from a `draggable` element. They shouldn't collide, but verify on first run.

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `c7f9a34` (vault: append post-handoff hotfix note to slice-5)
- **Uncommitted changes:** 3 files — `src/lib/types.ts` modified (added `merge_field_slug?: string` to `FormField`), `src/lib/contracts/merge-field-registry.ts` new (31 lines), `src/lib/contracts/merge-field-registry.test.ts` new (9 tests). Plus `out/` untracked (ignored).
- **Migrations applied this session:** none
- **Deployed to Vercel:** no
- **PRs opened:** none — work is on `main` working tree, not committed
- **GitHub issues created:** #65 (PRD), #66, #67, #68, #69, #70

## Notes for next session

- **Run `npx vitest run src/lib/contracts/merge-field-registry.test.ts` first.** 9/9 passing should be the starting state. If anything regressed, the working-tree edit to `src/lib/types.ts` (the `merge_field_slug?: string` addition) is the most likely culprit — that change was required for test 2 (legacy slug aliasing) and stays for the rest of the work.
- **Don't delete `MERGE_FIELDS` from `merge-fields.ts` yet** — it's still imported by `field-inspector.tsx`, `field-palette.tsx`, `template-pdf-editor.tsx`, `overlay-validation.ts`, `email-merge-fields.ts` (indirectly via `EMAIL_EXTRA_MERGE_FIELDS`), `payments/merge-fields.ts`, and `merge-field-node.ts`. Refactor consumers one at a time, then drop the array last.
- **The system-fields list** the resolver needs to handle: `date_today`, `intake_date`, `company_name`, `company_phone`, `company_email`, `company_address`, `company_license`, `adjuster_name`, `adjuster_phone`. Today's `buildMergeFieldValues` (`src/lib/contracts/merge-fields.ts:108`) is the reference — replicate its resolution paths inside the system-source dispatch of the new resolver.
- **Pill field rendering** (decision 9 in PRD): when a pill merge field is dropped as a text slot and resolves to a value, the resolver should return the option's `label`, not its `value`. Today's code uses `formatDamageType()` which title-cases the slug — that fallback should remain for fields without explicit `label` entries.
- **The "Other:" pattern** (PRD user story 22): no new field type needed. A checkbox bound to `property_type = "other"` ticks the Other box; a separate text merge slot bound to `property_type_other` (a `job_custom_fields` companion field that intake authors define manually) renders the freeform line. Verify intake form supports this companion-field pattern before #70 implementation — it may not today.
- **Pause-between-issues memory in effect.** When #67 lands fully (including manual demo), STOP and ask Eric to review before queueing #66 or any of #68/#69/#70.
- **Eric's `caveman` skill and `/loop` are available** but were not used this session. Mention if they'd speed up the next session's resolver TDD grind.

## Links

- PRD: [#65](https://github.com/ericdaniels22/Nookleus/issues/65)
- Slice 1: [#66](https://github.com/ericdaniels22/Nookleus/issues/66) — drag-to-pan
- Slice 2: [#67](https://github.com/ericdaniels22/Nookleus/issues/67) — dynamic merge fields (active)
- Slice 3: [#68](https://github.com/ericdaniels22/Nookleus/issues/68) — email pickers
- Slice 4: [#69](https://github.com/ericdaniels22/Nookleus/issues/69) — form-builder safety net
- Slice 5: [#70](https://github.com/ericdaniels22/Nookleus/issues/70) — auto-fill checkboxes
- Current state: [[00-NOW]]
- Related: [[build-15d]] (contract template overlay builder, the foundation this extends), [[build-14j]] (intake form builder, the data source for the new registry)
