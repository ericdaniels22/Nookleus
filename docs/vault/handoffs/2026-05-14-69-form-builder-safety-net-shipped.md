---
date: 2026-05-14
build_id: contracts-builder
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-14-66-drag-to-pan-shipped]]", "[[build-15d]]"]
---

# Build contracts-builder Handoff — 2026-05-14 (thirteenth session, #69 form-builder safety net shipped + browser smoke PASSED)

## What shipped this session

- **Source commit `c8a3a57` on branch `claude/69-form-builder-safety-net`** — `form-builder: id-immutability + usage warnings + delete-block (#69)`. Opened as **[PR #74](https://github.com/ericdaniels22/Nookleus/pull/74)** against `main`, merged at `26e49f6` 2026-05-14 19:30 UTC. 19 files, +774 / −19. Closes #69 via the body's `Closes #69` tag — issue auto-closed at 19:30:15 UTC.
- **Six AC table — all PASS end-to-end** in the live Vercel preview against AAA prod (Untitled Template (6), id `ec9b8c74-b7ff-4df5-a6ad-c1a33822a5aa`):
  - **AC1 (id immutability via server guard):** POST to `/api/settings/intake-form` with a payload that strips the prior referenced field id returned `409 { error: "field_referenced_by_templates", blocked: [{ field_id, label, slug, references: [{ id, name, is_active }] }] }`.
  - **AC2 (id read-only in inspector):** Field ID input rendered with `readOnly disabled` + `Lock` icon tooltip "Field ID is fixed after first save." Value shown is the slug (`merge_field_slug ?? id`), e.g. `customer_first_name` for the first-name row.
  - **AC3 (Used-by badge + expandable list):** Blue "Used by 1" / "Used by 2" badges rendered next to First Name, Phone, Email, Property Address, Test Phone Number; clicking the badge expanded an inline list showing "Untitled Template (6)" (with `(inactive)` suffix if applicable).
  - **AC4 (maps_to confirm on referenced field):** Programmatic `change` on the First Name `maps_to` select from `contact.first_name` → `contact.last_name` triggered the confirm modal "Change 'Maps to' for a referenced field?" listing Untitled Template (6) with Cancel/Change anyway buttons; Cancel left the select on First Name.
  - **AC5 (delete blocked w/ Hide instead):** Clicking the trash icon on the custom field `Test Phone Number` (custom_1778705362460, used-by-1) opened the block modal "Can't delete 'Test Phone Number'" with Untitled Template (6) listed + Cancel / Hide instead buttons.
  - **AC6 (hide succeeds + existing contracts still resolve):** Clicking Hide instead flipped `visible:false` on the custom field, autosaved as form_config v6 with no 409. A round-trip PATCH on the template's overlay_fields (containing the now-hidden slug) returned `200 OK` — proving `knownMergeNames` still includes hidden slugs and the resolver will still populate values for existing contracts. Field visibility restored to `true` at end of smoke (form_config v7). No template overlay_fields changed.
- **Smoke results posted as a [PR #74 comment](https://github.com/ericdaniels22/Nookleus/pull/74#issuecomment-4453975915)** with the six-AC table inline before merge.

## What's next

Per `feedback_pause_between_issues.md`: pause before kicking off the next slice. The only remaining unblocked candidate is **#70 (auto-fill checkboxes)**. #69 is now closed; #66 was closed last session; #67/#68 closed prior sessions. After #70 ships, contracts-builder's PRD (#65) is fully delivered.

Also still open from prior sessions: **#68 real-email demo** is on Eric (add custom intake field → drop into a signing-request template → send to self → confirm the new dynamic field resolves in the delivered email). Not blocking #70.

## Decisions locked

(Carried from prior sessions, plus one in-flight scope decision this session.)

- Ship #66–#70 as separate PRs/commits, not one bundled commit. Pause between issues.
- Migration path C (per-field `merge_field_slug` alias) for legacy template compatibility.
- Composite synonyms (`customer_name`, `customer_address`) live in `SYSTEM_MERGE_FIELDS`.
- **Hidden fields STAY in the merge-field registry (new this session, locked by AC6).** `buildMergeFieldRegistry` was changed from "skip hidden" to "include hidden, mark `hidden: true`." Picker consumers (`field-inspector`, `email-template-field`, `payment-email-template-field`) and `template-pdf-editor`'s default pick filter on `r.hidden` so authors can't pick hidden fields for new chips. This was a corrective change against #67's original semantics: without it, hiding a referenced field would have made the slug unknown to overlay-validation AND to the resolver, breaking existing contracts — directly contradicting AC6.

## New this session

- **The lookup module is split into a pure helper + a DB call** — `extractReferencedSlugs(overlay_fields)` and `buildReferenceIndex(templates, slugs)` are pure functions (9 unit tests cover edge cases including duplicate refs in one template + null overlay_fields + empty slug list); `findReferencingTemplates(supabase, slugs)` does the RLS-scoped fetch. Keeping the index-building logic pure makes the test surface meaningful — the Supabase round-trip is the only piece that isn't unit-tested.
- **`form-config-removal-guard.ts` is its own module, reused by two routes.** Both `POST /api/settings/intake-form` and `POST /api/settings/intake-form/restore` import it. Restore can effectively delete fields (when restoring an older config that lacks current fields), so it gets the same guard.
- **Client-side delete-block + server 409 are belt-and-suspenders.** The UI pre-emptively shows the block modal before the autosave fires, so 409 is only hit on races (concurrent template-create + field-delete). When 409 IS hit, `use-form-config.ts` parses the structured blocked array and surfaces a toast with template names, then `window.location.reload()` to revert local state from server truth.
- **The Inspector Field ID input shows the SLUG, not the raw id** — `merge_field_slug ?? id`. This is what authors see in contract templates and emails as `{{customer_first_name}}`. The raw id is a server-side join key into `job_custom_fields`; surfacing it would be confusing because it's typically `custom_1778705362460`-style for legacy fields after the #67 backfill.
- **Stop-propagation pattern on the Used-by badge** — the badge's `onClick` calls `e.stopPropagation()` so clicking the badge expands the inline usage list without selecting the field row (which would open the inspector). Same pattern as overlay-field-chip's `onPointerDown` from #66.
- **AAA prod has a real custom merge-field reference** — `Test Phone Number` (custom_1778705362460) is dropped onto Untitled Template (6) and was the test target for AC5. This is genuine state, not session-created — it has been there since the #67 manual demo. Useful smoke fixture going forward.

## Open threads

- **Eric's #69 "warn surface" note still TODO.** From the #66 handoff: "when designing slug-collision warnings, the warn surface should include collisions with `SYSTEM_MERGE_FIELDS` slugs AND `PAYMENT_MERGE_FIELDS` slugs, not just rename-of-existing-slug." Not part of #69's six ACs — explicit collision warnings during ADD/edit of merge_field_slug aren't surfaced in this slice. Worth a small follow-up: when an author types a slug that collides with a system or payment merge field, the inspector should warn ("This collides with the system slug `customer_name`"). File as #69b or fold into #70.
- **The Inspector confirm modal doesn't fire on the first edit if `field.maps_to` was undefined.** Today's logic is `(field.maps_to ?? "") === newValue ? skip`. So a previously-unmapped field going from "Custom field" → `contact.first_name` does NOT trigger the confirm (because the field had no maps_to to change). Edge case: if the unmapped field's slug IS already referenced by a template, that template was relying on `job_custom_fields` resolution; assigning a `maps_to` flips the resolution source mid-flight. Spec literally says "Changing a field's `maps_to` while it has contract-template references triggers a confirm dialog" — strict reading includes the unmapped→mapped case. Easy fix: drop the early-return when previous value was empty. Defer to #69b or #70 cleanup.
- **The Inspector Field ID input is disabled but doesn't have a select-all / copy-to-clipboard affordance.** Authors who need the slug to use elsewhere have to manually select the text. Minor UX polish.
- **#68 real-email demo** still on Eric (carried from prior sessions).
- **Inspector dropdown shows composite synonyms under "System"** (carried from #67).
- **`fetchLatestFormConfig` adds one extra org-fetch per resolution call** (carried — negligible single-row indexed lookup).
- **Cross-org caution** if `buildMergeFieldValues` is called with a non-existent or soft-deleted jobId (carried).
- **The preview-route `SAMPLE_MERGE_VALUES`** in `src/app/api/settings/contract-templates/[id]/preview/route.ts:13-36` is still keyed on old legacy field names (carried from #67).

## Mechanical state

- **Branch:** `main` (post-merge)
- **HEAD at session end:** `26e49f6` (Merge pull request #74 from ericdaniels22/claude/69-form-builder-safety-net)
- **Source commit (squashed into merge):** `c8a3a57` (`form-builder: id-immutability + usage warnings + delete-block (#69)`)
- **Branch `claude/69-form-builder-safety-net`:** merged + auto-deleted by GitHub
- **Uncommitted changes:** none (gitignored `out/` only); vault edits in progress at handoff time
- **Migrations applied this session:** none (pure application-layer feature)
- **Vercel:** auto-deploying `main` (#69's changes + the `cba795f` nav fixup that landed mid-session)
- **GitHub issues touched:** #69 auto-closed at 2026-05-14T19:30:15Z via the PR body's `Closes #69` tag
- **Mid-session drift on `main`:** `cba795f` "nav: drop body position:fixed lock, opaque overlay instead (#36 fixup)" landed on main between branch-fork and merge. Clean merge (zero file conflicts — disjoint surfaces).
- **`.env.local`:** never used this session — smoke ran against the Vercel PR preview directly, not localhost. No creds on disk.
- **Tests:** `npx vitest run` → **138/138 green** (+15 new across 2 files over the 123 baseline). `npx tsc --noEmit` clean on the changed surface; preexisting `src/lib/email/sync-folder-incremental.test.ts:246` error from #64 work remains.

## Notes for next session

- **First action when resuming:** confirm Vercel deployed `main` cleanly + #69 closed (should already be confirmed in vault). Then pick #70 (auto-fill checkboxes) per pause-between-issues. No pre-reads required beyond reviewing `OverlayFieldChip` and the inspector for checkbox-specific properties.
- **Lookup module is reusable.** `findReferencingTemplates(supabase, slugs)` is the canonical "which templates reference these slugs" query. If a future feature needs to walk template→form_config relationships, prefer this over re-implementing the JSONB walk.
- **The hidden-field registry change is load-bearing for AC6.** If anyone reverts `buildMergeFieldRegistry` back to "skip hidden," existing contracts referencing hidden slugs will start rendering as unresolved. The behavior is captured in two registry tests (`keeps fields where visible is false but marks them hidden`, `marks fields in hidden sections as hidden but keeps them in the registry`). Don't remove those tests without thinking hard.
- **Browser MCP permission popups from prior sessions** may still need re-approval. Vanessa's Mac kept denying `localhost:3001` navs even on retry; the workaround was driving the Vercel PR preview URL directly (different domain → different permission). For future smoke sessions: prefer the Vercel preview over localhost when working from Vanessa's Mac.
- **Service-role key wasn't actually needed for this smoke.** Both the form-config and contract-templates RLS-scoped queries went through the user session (anon JWT in cookie + Eric's auth). The earlier-session note that "the contract-template PDF route needs service-role" still holds for that specific route; #69's surface doesn't touch it.
- **For #70 (auto-fill checkboxes):** independent overlay-builder slice. Carried from the prior handoff. No registry changes anticipated — checkbox auto-fill operates on the overlay field's input, not on the merge-field registry.

## Links

- PR: [#74](https://github.com/ericdaniels22/Nookleus/pull/74) — this slice
- PRD: [#65](https://github.com/ericdaniels22/Nookleus/issues/65)
- Slice 1 (closed): [#66](https://github.com/ericdaniels22/Nookleus/issues/66) — drag-to-pan
- Slice 2 (closed): [#67](https://github.com/ericdaniels22/Nookleus/issues/67) — dynamic merge fields
- Slice 3 (closed): [#68](https://github.com/ericdaniels22/Nookleus/issues/68) — email pickers
- Slice 4 (this session): [#69](https://github.com/ericdaniels22/Nookleus/issues/69) — form-builder safety net
- Slice 5: [#70](https://github.com/ericdaniels22/Nookleus/issues/70) — auto-fill checkboxes (last unblocked)
- Prior session: [[2026-05-14-66-drag-to-pan-shipped]]
- Current state: [[00-NOW]]
- Related: [[build-15d]] (contract template overlay builder)
