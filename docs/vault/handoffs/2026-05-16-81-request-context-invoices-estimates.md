---
date: 2026-05-16
build_id: request-context
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-16-79-request-context-tracer-shipped]]"]
---

# Build request-context Handoff — 2026-05-16 (nineteenth session, slice #81 — invoices + estimates endpoints converted to `withRequestContext`)

## What shipped this session

Slice **#81** — converting the `invoices` and `estimates` API endpoints onto the `withRequestContext` wrapper built in #79. Implemented in worktree branch `worktree-81-request-context-invoices-estimates`; **one source commit, no migrations.** PR opened against `main`.

- **Converted all 30 invoices + estimates route files** from the four old gates to `withRequestContext`, mapping each `requirePermission` 1:1 to a rule:
  - **15 estimates routes** — rules `view_estimates` / `edit_estimates` / `create_estimates` / `manage_estimates` / `convert_estimates`.
  - **15 invoices routes** — rules `view_invoices` / `edit_invoices` / `create_invoices` / `manage_invoices`.
  - Each route became `export const METHOD = withRequestContext(rule, async (request, ctx, routeCtx) => { … })`; route-specific business logic (snapshot checks, status state-machines, ownership/trashed guards, audit rows) stays inside the handler.
- **Two previously-ungated routes wrapped logged-in-only** — `invoices/[id]/mark-sent` and `invoices/[id]/void` had only an inline `getUser()` check and used the Service client directly. Both are now `withRequestContext({ serviceClient: true }, …)` — no access change. **These two are the invoices/estimates entries for the #86 ungated-endpoint list.**
- **Mechanical changes inside handlers:**
  - Route-level `getActiveOrganizationId(supabase)` calls replaced with `ctx.orgId` (identical value — the wrapper already resolved it — and one fewer query); existing `if (!orgId)` guards kept for type-narrowing.
  - `estimates POST` uses `ctx.userId` for `created_by`; `invoices/[id]/void` uses `ctx.userId` for `voided_by`.
  - Audit rows that need the caller's *email* keep their own `ctx.supabase.auth.getUser()` call as route business logic (the Request Context carries `userId`, not email).
- **Added 18 converted-route tests** + a shared `src/app/api/__test-utils__/request-context-fakes.ts`, mirroring #79: gate wiring on a static route (`estimates/route`, `invoices/route`), a dynamic route (`estimates/[id]/status`), and a logged-in-only route (`invoices/[id]/void`) — 401 unauthenticated, 403 wrong-permission, admin-passes-without-key, handler-reached.
- **Verification:** typecheck clean (only the known pre-existing `sync-folder-incremental.test.ts` `TS2322` remains — filter it); lint clean on the changed surface; full suite **236 tests, 35 files** green (was 218/31).

## What's next

- **#82–#85 remain unblocked and grabbable in parallel** (each was blocked only by #79): #82 accounting+QuickBooks, #83 jobs+payments+payment-requests, #84 settings, #85 email+Jarvis+remaining.
- **#80** (contracts + item-library) also still open and unblocked.
- **#86** (delete the four old gates + publish the ungated-endpoint list) stays blocked until #80–#85 all land.
- Per `feedback_pause_between_issues.md` the conversion batches are reviewed and paused between — pick up one batch at a time.
- Still queued, untouched: **#58 umbrella** has #62 (Restore voided) + #63 (Permanently delete voided) `ready-for-agent`; the **#68 real-email demo** remains on Eric's plate.

## Decisions locked

- None this session. (The standardized rejection vocabulary and the conversion pattern were locked in #78/#79; #81 just follows them.)

## Open threads

- **#86 ungated-endpoint list** — `invoices/[id]/mark-sent` and `invoices/[id]/void` were previously ungated; they are now logged-in-only (`{ serviceClient: true }`). Note both for the #86 list. No other invoices/estimates endpoint was ungated.
- **Vocabulary change carried through** — `mark-sent`/`void` previously returned `401 { error: "unauthorized" }`; converted, they now return the standardized `401 { error: "Not authenticated" }`. Consistent with the #79 decision that #80–#85 routes adopt the new vocabulary.
- **Pre-existing unrelated typecheck error** — `src/lib/email/sync-folder-incremental.test.ts` `TS2322`, untouched; still the only `tsc` error in the repo; filter it from repo-wide typecheck.

## Mechanical state

- **Branch:** `worktree-81-request-context-invoices-estimates` (git worktree under `.claude/worktrees/`).
- **Commit at session start:** `26ae2b7` (`vault: handoff for #79 …`).
- **Uncommitted at handoff time:** 30 modified route files + 5 new files (4 test files + `__test-utils__/request-context-fakes.ts`) + this handoff + the `00-NOW.md` edit — all committed into the #81 PR.
- **Migrations applied this session:** none.
- **Deployed to Vercel:** n/a until the PR merges (Vercel auto-deploys on merge to `main`).

## Notes for next session

- **Conversion pattern held across 30 files.** A converted route is a one-line rule plus the route's own business logic; the gate is structural. `ctx.orgId` is the wrapper-resolved Active Organization — use it instead of re-calling `getActiveOrganizationId`. For a `{ permission }` rule, `ctx.orgId`/`ctx.role` are guaranteed non-null on success; for a `{}` (logged-in-only) rule they can be null.
- **Multi-method route files** become several `export const` declarations in one file. **Dynamic routes** annotate the handler's third arg (`{ params }: { params: Promise<{ id: string }> }`); `[id]/line-items/[item_id]` etc. carry both params.
- **The four old gates still exist** (`requirePermission`, `requireAnyPermission`, `requireAdmin`, `requireViewAccounting`) — old and new coexist by design until #86 deletes them. #81 removed every invoices/estimates *reference* to them, not the gates themselves.
- The `__test-utils__/request-context-fakes.ts` added here is intentionally separate from the expenses one (`expenses/__test-utils__/`); #82–#85 can reuse the new shared one.

## Links

- Issue: [#81](https://github.com/ericdaniels22/Nookleus/issues/81) — convert invoices + estimates endpoints
- PRD: [#78](https://github.com/ericdaniels22/Nookleus/issues/78) — Request Context wrapper (parent)
- Remaining slices: [#80](https://github.com/ericdaniels22/Nookleus/issues/80) · [#82](https://github.com/ericdaniels22/Nookleus/issues/82) · [#83](https://github.com/ericdaniels22/Nookleus/issues/83) · [#84](https://github.com/ericdaniels22/Nookleus/issues/84) · [#85](https://github.com/ericdaniels22/Nookleus/issues/85) · [#86](https://github.com/ericdaniels22/Nookleus/issues/86) (cleanup, blocked)
- Prior session: [[2026-05-16-79-request-context-tracer-shipped]]
- Current state: [[00-NOW]]
