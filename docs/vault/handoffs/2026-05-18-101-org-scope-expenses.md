---
date: 2026-05-18
build_id: ungated-security-triage
session_type: implementation
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-18-97-active-org-scope-guard]]", "[[2026-05-18-96-canonical-permission-keys]]"]
---

# Build ungated-security-triage Handoff — 2026-05-18 (twenty-seventh session — **PRD #95 slice #101 IMPLEMENTED + committed (`92cf3ca`) on `worktree-101-org-scope-expenses`; pushed; [PR #125](https://github.com/ericdaniels22/Nookleus/pull/125) OPEN against `main`, `Closes #101`**)

## What shipped this session

Issue [#101](https://github.com/ericdaniels22/Nookleus/issues/101) — **org-scope the four expenses Service-client GETs via the #97 guard**. This is the first *consumer* of the `belongsToActiveOrganization` guard module [[2026-05-18-97-active-org-scope-guard]] shipped as a tracer bullet.

The four expenses GETs read through the Service client (RLS bypassed) with no Active-Organization filter, so any logged-in user could read another Organization's expense data by id. Each handler now calls the guard before the read and returns **404** when it fails:

| Endpoint | Locator guarded |
|---|---|
| `GET /api/expenses/by-job/[jobId]` | `{ jobId }` — the job's own `organization_id` |
| `GET /api/expenses/by-activity/[activityId]` | `{ table: "job_activities", id }` — resolved to the job's org through `job_activities.job_id` |
| `GET /api/expenses/[id]/thumbnail-url` | `{ table: "expenses", id }` |
| `GET /api/expenses/[id]/receipt-url` | `{ table: "expenses", id }` |

**Guard change** — `src/lib/request-context/belongs-to-active-organization.ts`: the `RESOLVERS` map gained one entry, `expenses: directColumn("expenses")`, since the `expenses` table carries its own `organization_id` column (`NOT NULL` since build 45's migration). `jobs` and `job_activities` were already registered by #97. Per the module's own contract, registering a table is a deliberate act — the guard throws on an unknown table rather than quietly passing.

**Tests** — `by-job/route.test.ts` gained a cross-Organization 404 case and a missing-id 404 case (and its happy-path test now seeds the `jobs` table the guard reads). New test files for the three previously-untested routes (`by-activity`, `thumbnail-url`, `receipt-url`), each covering 401 / own-org 200 / cross-org 404.

**Decision recorded** in `docs/request-context-ungated-endpoints.md` — new `### #101` section under "Triage decisions (PRD #95)", and the #79 expenses section's gap note marked closed.

This is a data-scoping correctness fix only; it adds **no permission gate**. A resource in another Organization is now indistinguishable from a missing one (both 404); behavior is unchanged for resources in the caller's own Active Organization.

**Verification:** full suite **382 green / 61 files**; lint clean on the changed surface; typecheck clean except the pre-existing unrelated `sync-folder-incremental.test.ts` `TS2322` (carried). One source commit `92cf3ca`, 10 files, +409/−6. No migration.

## Git-tangle recovery (read this)

The session hit a tangled working tree and recovered. At session start git reported `main`, clean. Mid-session the main checkout `/Users/vanessavance/Desktop/Nookleus` was found on branch **`102-gate-payments`** with another session's uncommitted #102 work, untracked #98/#103 test files, and a shared **`stash@{0}`** ("WIP: concurrent #98/#101/#103 + my #102"). An initial pass of #101 edits made directly in that checkout was swallowed into that stash.

Per Eric's choice, #101 was **re-applied cleanly in a fresh worktree** (`.claude/worktrees/101-org-scope-expenses`, branch `worktree-101-org-scope-expenses`, off `main` at `960d0ae`) — isolated from the `102-gate-payments` checkout and the stash. Nothing in the tangled checkout was modified.

## What's next

- **Merge PR #125** → #101 auto-closes, Vercel auto-deploys (no migration; behavior-preserving security tightening).
- **PRD #95 remaining slices:** #98 (org-scope `contract-templates/[id]`), #99 (marketing/knowledge/notifications/Jarvis triage), #102 (gate payments), #103 (gate jobs files/photos), #104 (invoices void/mark-sent), #105 (email), #107 (settings area), #106 (contracts — HITL, needs a new permission key). #96/#97/#100 are merged.
- Each of #98/#99/#103/#104/#105 has its own worktree under `.claude/worktrees/` and is in flight in a parallel session.

## Open threads

- **⚠️ `stash@{0}` still holds an older copy of these same #101 edits**, bundled with #98/#103 ("WIP: concurrent #98/#101/#103…"). Once #125 merges, the #101 portion of that stash is redundant with `92cf3ca` — drop it when resolving the stash to avoid a conflict.
- **⚠️ The main checkout is on `102-gate-payments`** with another session's uncommitted #102 work and untracked #98/#103 test files. Those #98/#103 test files fail in isolation there because their route changes live in the stash, not the tree — not a regression, just incomplete parallel work. Do not commit that checkout's state as part of this handoff.
- The `request-context-ungated-endpoints.md` doc edited here (off `main`) does **not** include the #98/#99/#102 sections — those land with their own slices. Expect a merge-time append, not a conflict, since each slice adds a distinct `### #NN` block.
- **`00-NOW.md` is bloated** — body sections stale at slice #70; only the stacked `last_verified` frontmatter is maintained. Trim still overdue (carried).
- Pre-existing typecheck error — `sync-folder-incremental.test.ts` `TS2322`, untouched; filter from repo-wide typecheck (carried).
- Two crew-password-reset builds remain undocumented in the vault (carried from #115).

## Mechanical state

- **Branch:** worktree `.claude/worktrees/101-org-scope-expenses`, branch `worktree-101-org-scope-expenses`.
- **Commits this session:** `92cf3ca` (#101 source, 10 files) + the vault commit carrying this handoff and the `00-NOW.md` update.
- **`main`:** `960d0ae` at worktree creation (Merge PR #118, #100). Becomes a merge commit when #125 lands.
- **Migrations:** none. **Vercel deploy:** none yet — auto-deploys on PR #125 merge.
- **PR:** [#125](https://github.com/ericdaniels22/Nookleus/pull/125) OPEN against `main`, body declares `Closes #101`.
- **Worktree cleanup:** remove `.claude/worktrees/101-org-scope-expenses` after #125 merges.

## Notes for next session

#101 proves the #97 guard end-to-end: the guard module + one consumer slice is the pattern every remaining Service-client org-scoping fix follows. When a slice wires the guard into a route over a table not yet in `RESOLVERS`, register it there first (`directColumn` if the table has its own `organization_id`, `throughForeignKey` otherwise) — the guard throws on an unknown table by design.

## Links

- PRD: [#95](https://github.com/ericdaniels22/Nookleus/issues/95) — Security triage of the ungated logged-in-only endpoints (parent)
- This slice: [#101](https://github.com/ericdaniels22/Nookleus/issues/101) — Org-scope the four expenses Service-client GETs (OPEN, closes on #125 merge)
- PR: [#125](https://github.com/ericdaniels22/Nookleus/pull/125) — `Closes #101`
- Guard module slice (consumed here): [[2026-05-18-97-active-org-scope-guard]]
- Permission-key vocabulary slice: [[2026-05-18-96-canonical-permission-keys]]
- Current state: [[00-NOW]]
