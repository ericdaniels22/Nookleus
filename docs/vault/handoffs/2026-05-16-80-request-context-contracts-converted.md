---
date: 2026-05-16
build_id: request-context
session_type: implementation
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-16-79-request-context-tracer-shipped]]"]
---

# Build request-context Handoff — 2026-05-16 (nineteenth session, slice #80 contracts + item-library CONVERTED — 13 route files moved to `withRequestContext`, PR #90 opened)

## What shipped this session

Slice **#80** — the `contracts` + `item-library` conversion. **One source commit, no new modules, no migrations.** Behavior-preserving: each gated endpoint maps 1:1 to its rule; each ungated endpoint is wrapped logged-in-only.

- **11 of the 12 `contracts` API route files converted** (`reminders` left untouched — it is the `CRON_SECRET` endpoint, explicitly out of scope):
  - `DELETE /[id]`, `GET /[id]/pdf`, `POST /[id]/remind`, `/[id]/resend`, `/[id]/restore`, `/[id]/void`, `in-person`, `in-person/start`, `preflight`, `send` → **`{ serviceClient: true }`** (logged-in only; the Service client does the work, as before).
  - `GET by-job/[jobId]` → **`{}`** (logged-in only).
- **Both `item-library` route files converted:**
  - `GET /` and `GET /[id]` → **`{ permission: ["view_estimates", "view_invoices"] }`** — the old `requireAnyPermission` becomes a multi-key any-of `permission` rule (the case the PRD called out as proving the any-of path).
  - `POST /`, `PUT /[id]`, `DELETE /[id]` → **`{ permission: "manage_item_library" }`**.
- `user.id` → `ctx.userId` (restore / void / in-person-start / send `p_*_by` args, item-library `createItem`); `getActiveOrganizationId(...)` → `ctx.orgId` (preflight / send / item-library POST). The old hand-rolled `getUser()` 401 blocks and `createServiceClient()` calls are gone — the wrapper owns them.
- **No `contracts`/`item-library` endpoint imports `requirePermission`, `requireAnyPermission`, `requireAdmin`, or `requireViewAccounting`** any more.
- **Tests:** extended `makeAuthedFake` in `src/lib/contracts/__test-utils__/supabase-fake.ts` to also serve the wrapper's User-client auth-resolution queries (`auth.getSession`, `from("user_organizations")`, `from("user_organization_permissions")`), with an optional `{ role, grants }` arg for permission-rule tests; the 3 existing contract route test files pass unchanged. Added **15 converted-route tests** in two new files — `src/app/api/item-library/route.test.ts` and `[id]/route.test.ts` — covering 401 / 403 / each any-of key / happy paths.
- **Verification:** typecheck clean (only the pre-existing unrelated `sync-folder-incremental.test.ts` `TS2322` remains); lint **0 errors** (2 pre-existing "unused eslint-disable directive" warnings, one carried verbatim into `pdf/route.ts`, one in the untouched `reminders/route.ts`); full suite **233 passed, 33 files** (was 218 / 31).
- **PR [#90](https://github.com/ericdaniels22/Nookleus/pull/90) opened** from `claude/80-request-context-contracts` — **not merged**, pending review per `feedback_pause_between_issues.md`.

## What's next

- **#81–#85 remain unblocked and grabbable in parallel** — #81 invoices + estimates, #82 accounting + QuickBooks, #83 jobs + payments + payment-requests, #84 settings, #85 email + Jarvis + remaining.
- **#86** (delete the four old gates + publish the ungated-endpoint list) stays blocked until #80–#85 all land.
- Per `feedback_pause_between_issues.md`, review and merge the #80 PR before starting #81.
- Still queued, untouched: **#58 umbrella** has #62 + #63 `ready-for-agent`; the **#68 real-email demo** remains on Eric's plate.

## Open threads

- **`by-job/[jobId]` had no auth check at all** before this slice — it relied solely on the User client's row-level security. Wrapping it `{}` makes it structurally logged-in-only, so an unauthenticated caller now gets a 401 instead of an empty list. The PRD directs ungated endpoints to `{}`; flagged in a code comment for the #86 ungated-endpoint list.
- **Rejection vocabulary:** `item-library` previously returned 401 `not authenticated` / 403 `forbidden`; it now returns the wrapper's standardized 401 `Not authenticated` / 403 `Permission denied`, same as the #79 expenses conversion.
- **`{}` and `{ serviceClient: true }` routes run 2 extra auth queries** (membership + grants) to populate `orgId`/`role` — auth-lookup performance is out of scope per PRD #78.
- **The four old gates remain in place** (`requirePermission`, `requireAnyPermission`, `requireAdmin`, `requireViewAccounting`) — old and new styles coexist by design until #86 deletes them.
- **Pre-existing unrelated typecheck error** — `src/lib/email/sync-folder-incremental.test.ts` `TS2322`, untouched; still the only `tsc` error in the repo.

## Mechanical state

- **Branch:** `claude/80-request-context-contracts` (git worktree under `.claude/worktrees/`).
- **HEAD before this session's commits:** `26ae2b7` (`vault: handoff for #79 …`).
- **Source commits this session:** one source commit (13 route files + 1 test-util + 2 new test files) plus this vault handoff commit, pushed to the PR branch. **Migrations:** none. **Vercel deploy:** none yet — auto-deploys when the PR merges to `main`.
- **Uncommitted changes at handoff time:** the 14 modified files + 2 new test files + this handoff + the `00-NOW.md` frontmatter edit — all going into the PR branch.
- **GitHub:** PR [#90](https://github.com/ericdaniels22/Nookleus/pull/90) open for #80; issues #81–#86 + PRD #78 remain open; #81–#85 unblocked, #86 blocked.

## Notes for next session

- **Conversion pattern, now proven on contracts + item-library too:** replace the gate with `export const METHOD = withRequestContext(rule, async (request, ctx, routeCtx) => { … })`; map an existing gate 1:1 to its rule (`requireAnyPermission([...])` → `{ permission: [...] }`); wrap a currently-ungated route as `{}`; opt into the Service client with `{ serviceClient: true }` and read it as `ctx.serviceClient!`; keep route-specific business logic inside the handler. Annotate the handler's third arg on dynamic routes (`{ params }: { params: Promise<{ id: string }> }`).
- **`makeAuthedFake` now takes an optional second arg** `{ role?, grants?, orgId? }` — use it in #81–#85 converted-route tests that need to exercise a `permission` rule; default (no arg) is an authed caller with no membership, fine for `{}` / `{ serviceClient: true }` routes.
- **`CONTEXT.md`** at the repo root defines Organization / Active Organization / Request Context / User client / Service client.

## Links

- PR: [#90](https://github.com/ericdaniels22/Nookleus/pull/90) — Request Context conversion of contracts + item-library (open, pending review)
- PRD: [#78](https://github.com/ericdaniels22/Nookleus/issues/78) — Request Context wrapper (parent)
- Issue: [#80](https://github.com/ericdaniels22/Nookleus/issues/80) — convert contracts + item-library endpoints
- Remaining slices: [#81](https://github.com/ericdaniels22/Nookleus/issues/81) · [#82](https://github.com/ericdaniels22/Nookleus/issues/82) · [#83](https://github.com/ericdaniels22/Nookleus/issues/83) · [#84](https://github.com/ericdaniels22/Nookleus/issues/84) · [#85](https://github.com/ericdaniels22/Nookleus/issues/85) · [#86](https://github.com/ericdaniels22/Nookleus/issues/86) (cleanup, blocked)
- Prior session: [[2026-05-16-79-request-context-tracer-shipped]]
- Current state: [[00-NOW]]
