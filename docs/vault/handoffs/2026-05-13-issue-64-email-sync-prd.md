---
date: 2026-05-13
build_id: issue-64 (design + PRD only — no source changes)
session_type: focused
machine: TheLaunchPad
related: ["[[2026-05-13-void-restore-delete-prd]]"]
---

# Email sync speedup + per-account color PRD — 2026-05-13

## What this session was

A **design + PRD session that did not touch `src/`**. Two artifacts landed:

- **Design spec** at `docs/superpowers/specs/2026-05-13-email-sync-speedup-design.md` (committed `6cddcee`, pushed to `origin/claude/adoring-aryabhata-8ef45f`).
- **GitHub issue [#64](https://github.com/ericdaniels22/Nookleus/issues/64)** `Email sync speedup + per-account color indicator` with the `ready-for-agent` label, published via `/to-prd` after a `/grill-me` interview.

One source-tree commit (`6cddcee`) — the spec doc itself. The handoff commit is the only additional vault commit landing this session.

## What the user reported

Open-ended: _"I want to explore the emails page. lets brainstorm how we can can email sync and load faster overall."_

Narrowed during brainstorming: the **Sync button** is what feels slow. Manual click sits in "Syncing…" for many seconds before the inbox updates. Auto-sync on page mount inherits the same cost. Acceptable target = **<2s foreground**, with deferred work moving to the background.

Mid-session add-on: also asked for a **per-account color indicator** so emails in "All Inboxes" make their account visually obvious.

## The eleven grilled sync decisions (full PRD body is on issue #64)

1. **Sync = "show me new inbox mail."** Other jobs (attachment downloads, category backfill, job matching, weird folders) move out of the Sync hot path.
2. **Bookmark / UID high-water mark per `(account, folder)`.** New table `email_folder_state` stores `uid_validity` + `last_uid_seen`. Each sync asks IMAP "anything above the bookmark?" instead of refetching the last 100.
3. **One-time historical category backfill stays unoptimized.** It only runs when `category_backfill_completed_at IS NULL`. User: _"i do not care for optimizing a 1 time event."_
4. **Attachments save row first, upload after response** via Next.js `after()` (Fluid Compute keeps the function alive past the response). `EmailReader` shows a brief "Downloading…" placeholder when `has_attachments && attachments.length === 0`.
5. **Fast path = Inbox + Sent only.** Drafts, Trash, Spam, Archive don't sync on the button at all.
6. **Other folders use lazy per-tab sync.** Clicking the Drafts tab fires `POST /api/email/sync-folder` in the background; the existing rows render immediately. Throttled to 30s per folder.
7. **Multi-account sync runs in parallel.** Client swaps `for…of await` for `Promise.all`.
8. **Auto-sync on mount stays silent** — no spinner. The 60-second debounce that's already in `email-inbox.tsx` carries over.
9. **A "Last synced" indicator** beside the Sync button shows freshness in idle/in-flight/failed states. Updates via in-component 30-second interval.
10. **Manual Sync = same work as auto-sync** (Inbox + Sent), differs only in spinner visibility.
11. **Concurrent-click → promote silent to visible.** Click during a silent sync attaches to the existing in-flight promise via `useRef`; no duplicate request.

## Two grilled color decisions

12. **Color bar on the left edge of each row.** Hidden when only one active account exists. Visible in the email row AND the reading-pane header.
13. **Auto-assign palette with Settings override.** Order: `#0F6E56` Nookleus green → blue → amber → violet → rose → gray fallback. The first account in an org always gets Nookleus green. Override settable per-account in `/settings/email`.

## Module sketch confirmed (user picked tests for all three deep modules)

**Deep (testable, real logic) — TESTS REQUESTED for all three:**

- `syncFolderIncremental(client, account, folder, state) → { newEmails, newState, errors }` — pure-logic, no Supabase. Bootstrap vs steady-state vs UIDVALIDITY-mismatch branching. Tested without a real IMAP server (in-memory client stub).
- `assignAccountColor(orgId, existingColors, override?) → string` — pure function. Palette skip-used logic.
- `useEmailSync({ accounts, selectedAccountId }) → { syncing, lastSyncedAt, syncFailed, syncSilent, syncVisible }` — client hook state machine. `useRef` for the in-flight promise so concurrent clicks promote rather than duplicate.

**Shallow (glue, integration-only, no unit tests):**

- `POST /api/email/sync` — opens IMAP, calls `syncFolderIncremental` for Inbox + Sent in parallel, schedules attachments via `after()`.
- `POST /api/email/sync-folder` — new endpoint for lazy per-tab refresh.
- `uploadEmailAttachments(emailsWithAttachments)` — for-loop with per-email parallelism inside `after()`.
- `LastSyncedIndicator`, `AccountColorBar`, settings color picker — trivial UI.

**Schema:**

- New table `email_folder_state` (PK `(account_id, folder)`, RLS by `organization_id`, columns `imap_path`, `uid_validity`, `last_uid_seen`, `last_synced_at`).
- New column `email_accounts.color text`. Backfill by add-order using the palette via `ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at)`.

## Test prior art identified

- `src/lib/contracts/finalize.test.ts` — pattern for `syncFolderIncremental`: module-level `vi.mock`, `beforeEach` re-stamping after `vi.clearAllMocks()`.
- `src/lib/mobile/use-capture-mode.test.ts` — pattern for `useEmailSync`: `renderHook` + `act` + stubbed `localStorage`.

(Note: an earlier inherited open thread flagged `@testing-library/react` as not installed — the implementer of #64 will need to `npm i -D @testing-library/react` before the `useEmailSync` test file will run. Same fix the inherited mobile-test thread needs.)

## Architectural decisions locked in

- **No queue table / no new cron.** Deferred work uses Next.js `after()`. The QuickBooks-style queue pattern is intentionally **not** adopted — lifetime requirements here are seconds, not retries-across-hours, and Hobby-plan cron is daily-only.
- **Folder identity is the normalized name** (`inbox`, `sent`, etc.) — same vocabulary as the existing `mapFolder()` in the sync route. Raw IMAP path stored on `email_folder_state.imap_path` so we can reopen the right mailbox even when discovery order varies.
- **UIDVALIDITY mismatch = silent recovery, not user-visible error.** Wipe the state row, bootstrap the folder. Log `[email-sync] uidvalidity-reset account=<id> folder=<name>` to stdout — same prefix convention as `[qb-sync-scheduled]`.
- **Auto-assign palette order is fixed by add order.** Future accounts always pick the lowest unused palette index for the org. Locked in by the backfill SQL.

## Mechanical state at session end

- **Branch:** `claude/adoring-aryabhata-8ef45f` (worktree at `.claude/worktrees/adoring-aryabhata-8ef45f/` on TheLaunchPad).
- **HEAD at session start:** `2546ccc` (the evening void/restore/delete slice-3 vault commit) — also `origin/main` at session start.
- **HEAD at handoff write-time:** `6cddcee` — `docs(specs): email sync speedup & multi-account indicators design`.
- **`origin/main`:** still `2546ccc` (we branched off main; nothing merged this session).
- **`origin/claude/adoring-aryabhata-8ef45f`:** `6cddcee` (pushed mid-session before /handoff).
- **This handoff write becomes a single vault commit on top of `6cddcee`**, also pushed to `origin/claude/adoring-aryabhata-8ef45f`.
- **`main` was not touched.** The design spec + handoff live on the feature branch. Merging to `main` is the implementer's call when the implementation work is done — or sooner if the user wants the spec on main standalone.
- **Migrations:** none.
- **Vercel deploys:** none (docs-only changes + non-main branch).
- **TestFlight pushes:** none.
- **GitHub state:** **issue #64 created** with `ready-for-agent`. PR not opened — GitHub offered the URL at push time (`https://github.com/ericdaniels22/Nookleus/pull/new/claude/adoring-aryabhata-8ef45f`) but the user opted not to open one yet.
- **Memories saved this session:** none — decisions live in issue #64 + the design spec + this handoff.

## Open threads (new this session)

- **Implement #64 / email sync speedup + color indicator.** Natural next-session candidate. AFK-agent ready per the `ready-for-agent` label. Next-session flow: `/orient`, open issue #64, execute via `/tdd` against the three deep modules (`syncFolderIncremental`, `assignAccountColor`, `useEmailSync`), then wire the shallow routes + UI. Two migrations land (folder-state table, account-color column) ahead of code.

## Open threads (inherited, not addressed this session)

These remain open from the prior PRD handoff and earlier:

- Workplan Step 5 — Supabase auth-email templates + sender identity (manual, on Eric).
- iOS CI build failure on `2cfda55`.
- AAA workspace logo dependency on `company_settings.logo_path`.
- Implement #58 — void / restore / permanently-delete contracts. **Partially shipped late evening 2026-05-13** as `main` commits `6562143` (slices 1 + 2: menu mousedown bug, sidecar void watermark) and the prior slice-3 commits — but #58 itself wasn't checked for closure. Worth verifying state at next `/orient`.
- `@testing-library/react` not installed — needed for `useEmailSync` tests in #64.
- TestFlight push, portrait-lock Info.plist commit, Finding-B regression test, 65b.1 follow-up list, AAA QB sandbox token, 67c2 reviewer F4–F8, 5xx redactor sweep — all inherited, unchanged.

## Notes for the next session

- **The spec doc is the source of truth for implementation detail**, not the issue body. Issue #64 paraphrases for readability; the spec at `docs/superpowers/specs/2026-05-13-email-sync-speedup-design.md` has the schema SQL, the `after()` snippet, the file-by-file edit list, and the edge-case enumeration.
- **The user's goal is `<2s foreground sync`.** That's the verification target — instrument the new `/api/email/sync` to measure and confirm. If it doesn't hit `<2s`, re-grill.
- **Start with the migrations.** `email_folder_state` table + `email_accounts.color` column land first (two migrations), then `syncFolderIncremental` (with tests), then the route rewrite. Per the user's project convention, migrations are manually applied — don't try to auto-apply via the Supabase CLI.
- **The branch is `claude/adoring-aryabhata-8ef45f` and is on TheLaunchPad.** If the next session is on the Mac, you'll need to clone the worktree or work directly on `claude/adoring-aryabhata-8ef45f` after `git fetch`. The Mac is iOS-only per the user's memory, so probably continue on TheLaunchPad.
- **Three deep modules, three test files, in this order:**
  1. `assignAccountColor` — cheapest, pure function, ~5 tests. Locks in palette behavior.
  2. `syncFolderIncremental` — the algorithm. ~5 scenarios (bootstrap, steady-state empty, steady-state new, UIDVALIDITY mismatch, mailbox-open-fail). Mock the IMAP client.
  3. `useEmailSync` — last because it depends on `@testing-library/react` install + the routes existing for end-to-end verification.

## Links

- **Issue:** [#64](https://github.com/ericdaniels22/Nookleus/issues/64) — `ready-for-agent`, open.
- **Design spec:** `docs/superpowers/specs/2026-05-13-email-sync-speedup-design.md` (commit `6cddcee`).
- **PR offer (not opened):** `https://github.com/ericdaniels22/Nookleus/pull/new/claude/adoring-aryabhata-8ef45f`
- **Predecessor handoff:** [[2026-05-13-void-restore-delete-prd]]
- **Current state:** [[00-NOW]]
- **Sync route to be rewritten:** `src/app/api/email/sync/route.ts`
- **Inbox component to be modified:** `src/components/email-inbox.tsx`
- **Settings page to gain color picker:** `src/app/settings/email/page.tsx`
- **Test pattern references:** `src/lib/contracts/finalize.test.ts`, `src/lib/mobile/use-capture-mode.test.ts`
