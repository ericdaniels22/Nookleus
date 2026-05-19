---
date: 2026-05-18
build_id: request-context
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-18-96-canonical-permission-keys]]", "[[2026-05-18-97-active-org-scope-guard]]"]
---

# Build request-context Handoff — 2026-05-18 (twenty-seventh session — **PRD #95 slice #104 IMPLEMENTED on `worktree-104-gate-invoices-void-mark-sent` (`847daac`); branch pushed; [PR #122](https://github.com/ericdaniels22/Nookleus/pull/122) OPEN against `main`, NOT yet merged; issue #104 still OPEN.**)

## What shipped this session

Two things.

**1. Orientation.** Ran `/orient` — read the vault, captured git state, detected drift: the #96 handoff (the then-newest doc) described #97's PR #117 as "OPEN, not yet merged," but `d4f058a` had already merged it. Also flagged that the main checkout had uncommitted WIP spanning several other in-flight #95 slices — not this session's work, left untouched.

**2. Slice #104 — gate invoices void & mark-sent — implemented.** PRD #95 slice [#104](https://github.com/ericdaniels22/Nookleus/issues/104). One source commit `847daac` on a fresh worktree `worktree-104-gate-invoices-void-mark-sent` (cut off clean `main` at `dd57f15`, so the main checkout's unrelated WIP stayed isolated). Branch pushed; [PR #122](https://github.com/ericdaniels22/Nookleus/pull/122) opened against `main`, `Closes #104`. 5 files, +151/−10:

- **`invoices/[id]/void/route.ts`** — rule `{ serviceClient: true }` → `{ serviceClient: true, permission: "manage_invoices" }`. Void is a heavy lifecycle mutation; its siblings `/send`, `/delete`, `/restore`, and `DELETE /api/invoices/[id]` all require `manage_invoices`.
- **`invoices/[id]/mark-sent/route.ts`** — rule → `{ serviceClient: true, permission: "edit_invoices" }`. mark-sent only flips status `draft → sent` — the same DB effect as the `edit_invoices`-gated `PUT /api/invoices/[id]/status`. `/send` carries `manage_invoices` only because it *also* delivers email; mark-sent does not, so it sits with the lighter edit-class gate.
- **`invoices/[id]/void/route.test.ts`** — rewritten: the old "no permission key required" case replaced with 401 / 403-without-key / reaches-handler-with-key / admin-passes.
- **`invoices/[id]/mark-sent/route.test.ts`** — new file (mark-sent had no test before), same four cases.
- **`docs/request-context-ungated-endpoints.md`** — a "Triage outcome — #104" subsection added under the `## #81 — invoices + estimates` section recording both permission choices and the reasoning.

**Verification:** typecheck + lint clean on the changed surface; full suite **360 green / 56 files**, no regressions. No migration, no Vercel deploy (auto-deploys on PR merge).

## What's next

- **Merge PR #122** — #104 auto-closes; no-op Vercel deploy (a route gate, no consumer change).
- **PRD #95 remaining slices.** As of session end #96, #97, #99 are merged to `main`. Slices #98 / #101 / #102 / #103 / #105 are in flight on their own worktrees (see `git worktree list`). Still queued: **#100** (gate `settings/users/*` — the self-privilege-escalation hole, highest severity, independent), **#106** (gate the contracts endpoints — HITL, needs a human decision on introducing a contract-area permission key), **#107** (settings area).
- Per the house rule, slices are reviewed and paused between — don't auto-advance.

## Decisions locked

- **void → `manage_invoices`, mark-sent → `edit_invoices`.** Eric reviewed the implementation ("looks good") and approved Commit + push + PR. The split (mark-sent gets the lighter `edit_invoices` rather than mirroring `/send`'s `manage_invoices`) was the one judgement call the issue left to "confirm against the actual sibling rules" — confirmed and locked.

## Open threads

- **PR #122 is OPEN, unmerged.** #104 is not done until it merges. The `worktree-104-gate-invoices-void-mark-sent` worktree at `.claude/worktrees/104-gate-invoices-void-mark-sent` should be removed after merge.
- **Many parallel sessions in flight.** The repo had heavy concurrent activity this session — `git worktree list` shows worktrees for #98, #99, #101, #102, #103, #105. The main checkout is on branch `worktree-103-gate-jobs-files-photos` (not `main`) with untracked expenses test files. This handoff is scoped to #104 only; other slices' state belongs to their own handoffs.
- `00-NOW.md` is still bloated — only the stacked `last_verified` frontmatter is maintained; a trim is overdue (carried).
- Pre-existing, untouched, filter from any repo-wide check: `sync-folder-incremental.test.ts` `TS2322`; `react-hooks/set-state-in-effect` at `settings/users/page.tsx:94` (carried).

## Mechanical state

- **Branch:** `worktree-104-gate-invoices-void-mark-sent` (this session's work); main checkout currently on `worktree-103-gate-jobs-files-photos`
- **Commit at session end:** `847daac` (Gate invoices void and mark-sent (#104))
- **Uncommitted changes:** none in the #104 worktree (this handoff doc + `00-NOW.md` pending)
- **Migrations applied this session:** none
- **Deployed to Vercel:** no — auto-deploys on PR #122 merge

## Notes for next session

#104 is a pure access-control tightening — it changes the gate, not the route body. The only judgement was mark-sent's key: it shares `/send`'s DB effect but not its email side-effect, so it took `edit_invoices` to match `PUT /status` rather than `/send`'s `manage_invoices`. If a future reviewer disagrees, the swap is a one-word change in `mark-sent/route.ts` plus the grant strings in its test.

Because the worktree was cut from `dd57f15` (clean `main`) rather than the dirty main checkout, the #104 branch contains only #104. When PR #122 merges, `git worktree remove .claude/worktrees/104-gate-invoices-void-mark-sent` and delete the branch.

## Links

- PRD: [#95](https://github.com/ericdaniels22/Nookleus/issues/95) — Security triage of the ungated endpoints
- This slice: [#104](https://github.com/ericdaniels22/Nookleus/issues/104) — Gate invoices void and mark-sent
- PR: [#122](https://github.com/ericdaniels22/Nookleus/pull/122)
- Prior slices: [[2026-05-18-96-canonical-permission-keys]], [[2026-05-18-97-active-org-scope-guard]]
- Current state: [[00-NOW]]
