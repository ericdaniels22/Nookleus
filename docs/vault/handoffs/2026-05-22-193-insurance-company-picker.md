---
date: 2026-05-22
build_id: 193
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-21-187-form-config-migration]]"]
---

# Build 193 Handoff — 2026-05-22

## What shipped this session

Implemented issue [#193](https://github.com/ericdaniels22/Nookleus/issues/193)
— **slice 1 of PRD [#47](https://github.com/ericdaniels22/Nookleus/issues/47)**
(insurance-company picker for intake form and job detail): the
insurance-company picker on the job-detail screen, in its
**select-existing-only** form. Built via `/tdd` in an isolated worktree, full
red→green loop; the schema migration was **applied to AAA prod**.

Insurance companies are `contacts` with `role = 'insurance'` — a role the
schema already supported and the Contacts page already creates. This slice
adds the job → insurance link and a shared picker used inside the job-detail
Edit Insurance dialog.

- **`supabase/migration-193-jobs-insurance-contact-id.sql`** — adds a nullable
  `jobs.insurance_contact_id` uuid column, a foreign key to `contacts(id)`
  `ON DELETE SET NULL`, and index `idx_jobs_insurance_contact_id`. Mirrors the
  `build77` cover-photo migration; no backfill (starts NULL for every job).
- **`src/components/insurance-company-picker.tsx`** (new) — a shared
  search-as-you-type picker over `role = 'insurance'` contacts. Pure interface
  — `value: Contact | null` + `onChange` — so it is reusable for the intake
  form later. **Select-existing-only**; the "+ New" create affordance is
  slice 2. Cross-organization isolation is delegated to row-level security on
  `contacts`, exactly as the existing adjuster search is.
- **`src/components/insurance-company-picker.test.tsx`** (new) — 6 tests built
  one at a time as **6 red→green cycles**: a match renders as you type; each
  match shows its claims email; selecting fires `onChange(contact)`; a
  no-match search shows an empty state; a linked company is shown; clearing
  fires `onChange(null)`.
- **`src/lib/types.ts`** — `Job` gains `insurance_contact_id: string | null`
  and the joined `insurance_contact?: Contact | null`.
- **`src/components/job-detail.tsx`** — `fetchData`'s jobs select joins
  `insurance_contact:contacts!insurance_contact_id(*)`; the Edit Insurance
  dialog swaps its free-text input for the picker; `handleSave` writes
  `insurance_contact_id` **and** the `insurance_company` name snapshot **only
  when the picker was touched**; the read-only insurance card renders the
  linked company's claims email as a `mailto:` link.
- Two `makeJob` test fixtures (`job-comfortable-row.test.tsx`,
  `job-list-row.test.tsx`) gained `insurance_contact_id: null` to satisfy the
  widened `Job` type.

Full suite **837 tests pass** (128 files, +6); `tsc` clean apart from the
pre-existing `sync-folder-incremental.test.ts` error; ESLint reports **0 new
problems** (the new picker file is clean; `job-detail.tsx`'s 6
`set-state-in-effect` errors are identical on `main`).

**The migration was applied to AAA prod** (`rzzprgidqbnqcdupmpfe`) via Supabase
`apply_migration` (name `migration_193_jobs_insurance_contact_id`) after the
user's explicit plain-text "yes apply" (per
`feedback_supabase_mcp_prod_migration_approval`). Verified post-apply:
`jobs.insurance_contact_id` is `uuid`, the FK is `ON DELETE SET NULL`
(`confdeltype = 'n'`), and `idx_jobs_insurance_contact_id` is present.

## What's next

- **Commit branch `193-insurance-company-picker` and open a PR** (`Closes
  #193`). The user invoked `/handoff` before answering whether to commit + PR,
  so the 7-file implementation is still uncommitted in the worktree — that is
  the immediate next step. The migration is already on prod, so the PR just
  lands the source-of-truth files.
- **Browser-verify on AAA prod:** create an insurance company on the Contacts
  page, open a job's Edit Insurance dialog, pick it, and confirm the link +
  the `insurance_company` snapshot + the `mailto:` claims-email link on the
  read-only card; confirm a legacy free-text-only job still renders.
- **PRD #47 slice 2:** the picker's "+ New" create affordance, and (per the
  PRD title) wiring the picker into the intake form.
- **Tear down the worktree** `.claude/worktrees/193-insurance-company-picker`
  and its branch after the PR merges.

## Decisions locked

- **Legacy free-text insurance names are preserved, not erased.** When the
  Edit Insurance dialog opens on a job that has a free-text `insurance_company`
  name but no linked contact, a save that does not touch the picker leaves
  that name untouched; the dialog surfaces it as a "Currently: … not linked to
  a contact" note. The user explicitly chose this ("Preserve, surface it")
  over a strict-snapshot model that would null the legacy name on first save.
- The user gave one explicit plain-text approval — "yes apply" — to run the
  migration against AAA prod, the only gated action this session.

## Open threads

- **Branch `193-insurance-company-picker` is uncommitted.** #193 stays open
  until it is committed and a PR merges. The migration is already live on
  prod, so the prod schema and the uncommitted source are briefly out of step
  — the same shape as the #186 / #187 flow, and safe here because the new
  column is nullable with no backfill and nothing reads it until the branch
  lands.
- **Not browser-verified.** The picker's behavior is covered by component
  tests (mocked Supabase); the end-to-end path on AAA prod has not been
  exercised in a browser.
- **Pre-existing issues, untouched by #193:** `sync-folder-incremental.test.ts`
  has a `tsc` error in IMAP-mock typing, and `job-detail.tsx` carries 6
  `react-hooks/set-state-in-effect` lint errors — both identical on `main`.
- **`00-NOW.md` is still bloated** (~600 KB+, dozens of archived
  `last_verified` entries). Flagged since the #184 handoff, still unaddressed
  — worth a dedicated trim pass.

## Mechanical state

- **Branch:** `main` (this handoff). The #193 work was done on
  `193-insurance-company-picker` in worktree
  `.claude/worktrees/193-insurance-company-picker`, both left in place.
- **Commit at session end:** main checkout at `2b840c8` (`vault: handoff #187
  addendum — PR #192 merged …`) before this handoff commit. No feature commit
  yet — the #193 implementation is uncommitted in the worktree.
- **Uncommitted changes:** in the worktree, 7 files (4 modified, 3 new) — the
  #193 implementation. In the main checkout, this handoff file + the
  `00-NOW.md` update only.
- **Migrations applied this session:** yes —
  `migration_193_jobs_insurance_contact_id` applied to AAA prod
  (`rzzprgidqbnqcdupmpfe`) via Supabase `apply_migration`; added
  `jobs.insurance_contact_id` (uuid, nullable, FK → `contacts` `ON DELETE SET
  NULL`) plus `idx_jobs_insurance_contact_id`.
- **Deployed to Vercel:** no — the feature branch is not committed or merged.

## Notes for next session

- The migration was applied to prod **before** the feature branch is
  committed, on purpose: the new `job-detail.tsx` PostgREST join
  (`insurance_contact:contacts!insurance_contact_id(*)`) only resolves once
  the FK exists in the database. Whoever lands the PR does not need to apply
  anything — the schema is already there.
- `insurance_company` is deliberately **kept** as a denormalized name
  snapshot. Every existing reader (Jarvis context, CSV export, report builder,
  report PDF, job card) still reads that free-text column and is untouched.
  The picker only rewrites it — from the selected contact's `full_name` — when
  the picker is actually used.
- The picker's org-scoping is enforced by RLS on `contacts`, so it is not
  separately unit-tested (a mocked Supabase client cannot exercise RLS). This
  matches the existing `AddAdjusterDialog` contact search, which is the
  picker's closest prior art and was the model for the search query.
- `node_modules` inside the worktree is a symlink to the main checkout's
  (`git worktree` does not copy it); `npx vitest` in the worktree depends on
  that symlink.
- Slice 2 should extend this same component with a "+ New" mode — the
  `value` / `onChange` interface was designed to stay stable when that lands.

## Post-handoff update

After this handoff was written, the user asked to commit the feature branch,
open a PR, and merge it. The first "What's next" item is now done:

- **Feature branch committed and pushed** — one commit `2887ca1` (`feat:
  insurance-company picker on job detail (#193)`, 7 files, +364/−15) on
  `193-insurance-company-picker`.
- **[PR #196](https://github.com/ericdaniels22/Nookleus/pull/196)** opened
  against `main` with `Closes #193`, then **merged** (`gh pr merge --merge
  --delete-branch`) — merge commit `800eb18` on `main`, issue **#193
  auto-closed**.
- The worktree `.claude/worktrees/193-insurance-company-picker` and its local
  + remote branch were removed; the main checkout was synced to `800eb18`.

The migration was already applied to AAA prod, so the merge makes no schema
change; its Vercel deploy ships the picker UI to the web. The end-to-end path
still has not been browser-verified (see "Open threads").

## Links

- Issue: [#193](https://github.com/ericdaniels22/Nookleus/issues/193)
- Parent PRD: [#47](https://github.com/ericdaniels22/Nookleus/issues/47)
- Current state: [[00-NOW]]
- Prior handoff: [[2026-05-21-187-form-config-migration]]
