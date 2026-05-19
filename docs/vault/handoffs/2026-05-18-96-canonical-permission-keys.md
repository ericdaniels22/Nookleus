---
date: 2026-05-18
build_id: request-context
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-16-85-request-context-email-jarvis-shipped]]", "[[2026-05-18-97-active-org-scope-guard]]", "[[2026-05-18-115-drop-legacy-name-columns]]"]
---

# Build request-context Handoff — 2026-05-18 (twenty-sixth session — **PRD #95 slice #96 IMPLEMENTED, MERGED to `main` (`8672753`) and pushed; issue #96 CLOSED. Also: PRD #78 closed as delivered, the #85 handoff doc salvaged into the vault, two stale worktrees removed.**)

## What shipped this session

Three things, in order.

**1. Issue #78 housekeeping + worktree cleanup.** Investigated #78 ("Request Context wrapper" PRD) — found it fully delivered (all 8 slices #79–#86 merged) but left stale-open; **closed it** with a comment pointing to follow-up #95. Cleaned up two leftover request-context worktrees still on disk (`84-request-context-settings`, `85-request-context-email-jarvis`) — both slices were merged via squash (PRs #92/#93), so the worktree branches looked "unmerged" only because of differing SHAs. Worktree 85 held an **uncommitted #85 session handoff doc that existed nowhere in `main`**; salvaged it to `docs/vault/handoffs/2026-05-16-85-request-context-email-jarvis-shipped.md` and committed it (`21143d2`, pushed) before force-removing the worktree. Both worktrees + branches deleted.

**2. PRD #95 sliced state confirmed.** #95 ("Security triage of the ungated endpoints") was already decomposed by `/to-issues` into 12 issues #96–#107, all open; inventory doc `docs/request-context-ungated-endpoints.md` exists. No planning needed.

**3. Slice #96 — canonical permission-key vocabulary — implemented and merged.** Source commit `3ea00cc`, merged `--no-ff` to `main` as `8672753`, pushed; branch `worktree-96-canonical-permission-keys` deleted. 5 files, +123/−36:

- **New `src/lib/permissions/permission-keys.ts`** — the single source of truth. A 30-entry `PERMISSION_CATALOG` (`key`/`label`/`group`, `as const satisfies readonly PermissionDescriptor[]`), with `PermissionKey` + `PermissionGroup` types and `PERMISSION_KEYS` / `PERMISSION_GROUPS` derived from it.
- **`evaluate-permission-rule.ts`** — `PermissionRule.permission` narrowed `string | string[]` → `PermissionKey | PermissionKey[]`. A rule naming an unknown key is now a **compile error**, not a silent always-deny.
- **`settings/users/route.ts`** — deleted the hand-written 13-key `ALL_PERMISSIONS`; new members are seeded from `PERMISSION_KEYS` (all 30). `ROLE_DEFAULTS` typed `Record<string, readonly PermissionKey[]>`; `admin` = `PERMISSION_KEYS`, `crew_lead`/`crew_member` grant lists **unchanged**.
- **`settings/users/page.tsx`** — the permission-management UI's local 12-key list and hardcoded group array replaced with `PERMISSION_CATALOG` / `PERMISSION_GROUPS`.
- **`evaluate-permission-rule.test.ts`** — 4 `const rule` declarations annotated `: PermissionRule` (the narrowed type made TS reject literals widened to `string`); every key used was already valid.

The fragmentation the PRD called out is closed: the 17 keys that gates check but neither list seeded (`view_invoices`, the estimate keys, `manage_*`, `log_expenses`, etc.) are now seeded and visible in the management UI.

**Verification:** typecheck clean on the changed surface (only the pre-existing unrelated `sync-folder-incremental.test.ts` `TS2322` remains); lint zero-new (the one `react-hooks/set-state-in-effect` at `settings/users/page.tsx:94` is pre-existing on an untouched line); full suite **342 green / 54 files** — exactly the baseline. Behavior-preserving: `resolveCaller` filters `granted=true`, so seeding the 17 extra keys with `granted:false` is invisible to access evaluation.

## What's next

PRD #95 has 10 slices left (#97–#107). **#97 was implemented this same day by a parallel session** (worktree `97-active-org-scope-guard`, commit `419b181`) — it is in **[PR #117](https://github.com/ericdaniels22/Nookleus/pull/117), OPEN against `main`, not yet merged**. See [[2026-05-18-97-active-org-scope-guard]]. Dependency order:

- **#97 — Active-Organization scoping guard module** — DONE, awaiting merge of PR #117. Merging it unblocks #98 + #101 (a no-op Vercel deploy — no consumers yet).
- **Tier 1 fixes:** #98 (org-scope `contract-templates/[id]` GET/DELETE — needs #97 merged), #100 (gate `settings/users/*` — independent; the most urgent hole, self-privilege-escalation), #101 (org-scope the four expenses Service-client GETs — needs #97 merged).
- **Tier 2 policy mapping — all now unblocked by #96:** #99 (marketing/knowledge/notifications/Jarvis), #102 (payments), #103 (jobs files/photos + search), #104 (invoices void/mark-sent), #105 (email), #107 (settings area).
- **#106 — gate the contracts endpoints** — HITL; the only slice not labeled `ready-for-agent`. Needs a human decision: no contract-area permission key exists; introducing one is deferred to this slice per #96's "existing keys only" scope.

## Decisions locked

- **The `settings/users` seed list expands to all 30 canonical keys** — Eric chose this explicitly over keeping the 13-key subset. New members get a `user_organization_permissions` row for every key; this makes the 17 previously-un-grantable gate keys toggleable.
- **The permission-management UI (`settings/users/page.tsx`) is in scope for #96** — Eric chose to include it, so the UI and route gates provably share one vocabulary (PRD #95 story 11), rather than deferring it to settings slice #107.

## Open threads

- **The 17 newly-seeded keys default to `granted:false` for `crew_lead`/`crew_member`.** #96 made them grantable; it deliberately did **not** change `ROLE_DEFAULTS`. If a feature area wants crew to hold e.g. `view_invoices` by default, that is a `ROLE_DEFAULTS` change a future slice makes deliberately.
- **Pre-existing lint** — `react-hooks/set-state-in-effect` at `settings/users/page.tsx:94` (`fetchUsers()` in a `useEffect`); untouched by #96, filter it.
- **Pre-existing typecheck error** — `sync-folder-incremental.test.ts` `TS2322`, untouched; filter it from repo-wide typecheck.
- `00-NOW.md` is still bloated — only the stacked `last_verified` frontmatter is maintained; a trim is overdue (carried).
- `schema.sql` still stale in general respects (carried from #115).
- Two crew password-reset builds (`6a0df10`/`6c84ada`, `7da70d2`/`a4f7659`) merged to `main` without handoffs (carried).
- Still queued, untouched: #58 umbrella has #62 + #63 `ready-for-agent`; the #68 real-email demo is on Eric's plate.

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `8672753` (Merge worktree-96-canonical-permission-keys: canonical permission-key vocabulary (#96)) — plus the earlier `21143d2` (salvaged #85 handoff)
- **Uncommitted changes:** none (untracked `out/` build dir only)
- **Migrations applied this session:** none
- **Deployed to Vercel:** yes — auto-deploy on merge to `main` (`8672753`)

## Notes for next session

#96 is a pure-vocabulary slice; it changed no access decision. Its lasting value is the **type narrowing** — `PermissionRule.permission: PermissionKey | PermissionKey[]` means every later #95 slice that assigns a gate a rule gets the typechecker as a guard against typo'd or invented keys. When #106 introduces a contract-area key, add it to `PERMISSION_CATALOG` first and the rest type-checks itself.

**#97 (the guard tracer) was built in parallel the same day and sits in PR #117 awaiting review/merge** — merging it unblocks the two cross-tenant data-leak fixes (#98, #101). #100 (settings/users gating — the self-privilege-escalation hole) is independent of both #96 and #97 and is arguably the single highest-severity fix; it can be picked up immediately.

Per the house rule, slices are reviewed and paused between — don't auto-advance.

## Links

- PRD: [#95](https://github.com/ericdaniels22/Nookleus/issues/95) — Security triage of the ungated endpoints
- This slice: [#96](https://github.com/ericdaniels22/Nookleus/issues/96) — Canonical permission-key vocabulary (CLOSED)
- Parent PRD (delivered, closed this session): [#78](https://github.com/ericdaniels22/Nookleus/issues/78) — Request Context wrapper
- Prior request-context session: [[2026-05-16-85-request-context-email-jarvis-shipped]]
- Current state: [[00-NOW]]
