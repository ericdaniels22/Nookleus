---
date: 2026-05-18
build_id: full-name
session_type: triage + implementation
machine: TheLaunchPad
related: ["[[2026-05-18-109-full-name-prd-and-slice-1]]"]
---

# Build full-name Handoff — 2026-05-18 (twenty-second session — **slice #111 IMPLEMENTED on `worktree-111-merge-fields` (2 commits, HEAD `d66d9ea`); `migration-111` APPLIED to the production DB; branch about to be pushed + PR'd; issue #111 still OPEN**)

## What shipped this session

Triaged and implemented **slice #111** of the `full-name` PRD #109 — "merge fields & contract templates", the slice that fixes Eric's reported contract gap.

**Triage (`/triage`):**
- #109 (the PRD): recommended moving off `ready-for-agent` to `ready-for-human` as an umbrella tracker — not actioned (Eric moved on to #111).
- #111: posted a blocker-cleared triage note (#110 closed → #111 unblocked) and a migration prerequisite.

**Scope correction — #111's spec was written against a removed schema.** The issue/PRD assumed contract templates have document-body content with Tiptap pill spans + raw `{{customer_first_name}}` tokens, fixed by a pure HTML-rewrite module. Live-DB inspection found `contract_templates` has **no `content`/`content_html` columns** — they were dropped when PDF-overlay templates shipped (build 15d). Contract templates are now **purely `overlay_fields`** (PDF text stamps at fixed x,y). The "gap" is the literal space between two independently-positioned stamps. Slugs are org-specific (`customer_first_name` + `last_name`, form_config-derived), so name fields are identified via the merge-field registry, not string match. The corrected scope was posted on #111; Eric chose to re-scope (over re-grilling) — the rewrite became an `overlay_fields` transform.

**Implementation** (branch `worktree-111-merge-fields`, off `origin/main` `7e3953d`):
- **`src/lib/contracts/merge-field-resolver.ts`** — `customer_name` / `adjuster_name` now resolve from `contacts.full_name` (was a `first_name + last_name` join). `merge-field-resolver.test.ts` updated to seed `full_name`.
- **`src/lib/contracts/template-name-rewrite.ts`** (new) — pure `rewriteOverlayNameFields(overlayFields, registry)`: renames a first-name overlay stamp to `customer_name`, drops the redundant last-name stamp; a lone last-name stamp is renamed instead. Name fields identified by their `maps_to` registry mapping, not slug string. Built test-first (TDD): **9 tests** in `template-name-rewrite.test.ts`.
- **`supabase/migration-111-contract-template-name-rewrite.sql`** (new) — single-`do`-block migration rewriting every org's `contract_templates.overlay_fields`, with a safety assertion. Mirrors the TS module.
- **`src/app/api/settings/contract-templates/[id]/preview/route.ts`** — `customer_first_name` removed from `SAMPLE_MERGE_VALUES`.
- **Verification**: typecheck clean (only the pre-existing unrelated `sync-folder-incremental.test.ts` `TS2322`); lint clean on the changed surface; full suite **328 green / 52 files** (was 319/51, +9 for the new module).
- Two commits: `8165bdf` (the slice) + `d66d9ea` (the migration fix below).

**`migration-111` APPLIED to the production DB** (`rzzprgidqbnqcdupmpfe`). The active "Work Authorization" template's `last_name` overlay stamp is dropped and its first-name stamp renamed to `customer_name` — Eric's gap is fixed. "Emergency Service Work Auth" likewise. Safety assertion passes.

## What's next

- **Push `worktree-111-merge-fields` + open a PR** against `main` — this is the immediate next step (Eric asked for handoff → push → PR).
- **#113** (display sites & contact UI) and **#114** (QuickBooks sync) remain OPEN + `ready-for-agent`. **#115** cleanup stays blocked until #111/#113/#114 land.
- Close **#111** when the PR merges.

## Open threads

- **#111/#112 coupling discovered the hard way.** #112 (intake form & form builder) was implemented + **merged to `main` on a separate branch mid-session** (`68cdf41`, plus `398b6bf` migration-112 fix). #112's form_config migration collapses each org's *latest* `form_config` to a single `contact.full_name` field — which erased the `contact.first_name`/`contact.last_name` mappings that migration-111's first cut relied on (it scanned only the latest form_config). Symptom: the first two `apply_migration` runs were silent no-ops. **Fix** (commit `d66d9ea`): migration-111 now scans **every** form_config version of an org for name slugs, making it order-independent of #112.
- **Migration-history cruft.** The two no-op `apply_migration` attempts — `contract_template_name_rewrite_111` and `_v2` — are recorded in Supabase's `schema_migrations`. `_v3` is the one that took effect. Harmless (no-op SQL); offered to delete the two rows, awaiting Eric's call.
- **`Untitled Template (6)`** (inactive) now carries two `customer_name` overlay stamps — a pre-existing oddity (the user had placed both a `customer_name` and a first-name stamp); not introduced by the rewrite, left as-is.
- **The TS module and the SQL migration are no longer perfectly mirrored on slug identification** — the module takes a registry (one config), the migration scans all versions — but the *transform* logic (rename first / drop last) is identical. The module is a tested, parameterised primitive; the SQL is what actually ran.
- Branch `worktree-111-merge-fields` is behind `origin/main` by #112's merge — merge-base `7e3953d`. The 6 changed files are clean #111-only changes; consider merging `origin/main` in before/after the PR.
- Pre-existing unrelated typecheck error `sync-folder-incremental.test.ts` `TS2322` — untouched.

## Mechanical state

- **Branch:** `worktree-111-merge-fields` — HEAD `d66d9ea`, 2 commits (`8165bdf`, `d66d9ea`), merge-base `7e3953d`. Worktree at `.claude/worktrees/111-merge-fields`. **Not yet pushed.**
- **`origin/main`:** `398b6bf` — #112 (intake form full_name) merged in this session window.
- **Source commits this session:** two, on the branch. **Migrations:** one (`migration-111-...`), **APPLIED to production** (recorded as `contract_template_name_rewrite_111_v3`). **Vercel deploy:** none yet (auto on PR merge).
- **GitHub:** PRD [#109](https://github.com/ericdaniels22/Nookleus/issues/109) OPEN; [#111](https://github.com/ericdaniels22/Nookleus/issues/111) OPEN (PR pending); [#112](https://github.com/ericdaniels22/Nookleus/issues/112) merged; [#113](https://github.com/ericdaniels22/Nookleus/issues/113)/[#114](https://github.com/ericdaniels22/Nookleus/issues/114) `ready-for-agent`; [#115](https://github.com/ericdaniels22/Nookleus/issues/115) blocked.

## Notes for next session

- **`template-name-rewrite.ts` is the canonical overlay rewrite logic**; `migration-111` mirrors its transform. If #113/#114 touch overlay merge fields, reuse it.
- The unlabeled triage backlog (#40–#56, #106) was surfaced via `/triage` but not actioned.
- `00-NOW.md` is still ~440 KB of stacked archived `last_verified` entries — a trim remains overdue.

## Links

- PRD: [#109](https://github.com/ericdaniels22/Nookleus/issues/109) — Combine customer first/last name into a single full_name
- This slice: [#111](https://github.com/ericdaniels22/Nookleus/issues/111) — merge fields & contract templates
- Prior session: [[2026-05-18-109-full-name-prd-and-slice-1]]
- Current state: [[00-NOW]]
