---
date: 2026-05-18
build_id: ungated-security-triage
session_type: implementation
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-18-115-drop-legacy-name-columns]]"]
---

# Build ungated-security-triage Handoff — 2026-05-18 (twenty-sixth session — **issue #97 IMPLEMENTED on `worktree-97-active-org-scope-guard` (`419b181`); branch pushed; [PR #117](https://github.com/ericdaniels22/Nookleus/pull/117) OPEN against `main` — NOT yet merged; issue #97 still OPEN**)

## What shipped this session

The first slice of PRD [#95](https://github.com/ericdaniels22/Nookleus/issues/95) (security triage of the ungated logged-in-only endpoints). Issue [#97](https://github.com/ericdaniels22/Nookleus/issues/97) — the **Active-Organization scoping guard module**. This is the **tracer-bullet** slice: a small, isolately-testable guard with **no route consuming it yet** — consumers land in slices #95/5 and #95/9.

Work was done in worktree `.claude/worktrees/97-active-org-scope-guard` (branch `worktree-97-active-org-scope-guard`), one source commit `419b181`. No migration.

**Module — `src/lib/request-context/belongs-to-active-organization.ts`** (new): the tenant-scoping guard for Service-client routes. A User-client route gets tenant isolation for free — row-level security makes the database refuse a cross-Organization read; a Service-client route does not, because the Service client bypasses RLS, so the route is responsible for the check. The module is that check in one place.

- Exported `belongsToActiveOrganization(client, locator, activeOrgId): Promise<boolean>` — answers a single boolean question: does the located resource belong to that Active Organization.
- `ResourceLocator` is a union: **direct** `{ table, id }` (tables that carry an `organization_id` column) and the **`{ jobId }` shorthand** (the locator most Service-client routes have at hand; shorthand for `{ table: "jobs", id }`).
- **Indirect resolution** via a per-table `OrgResolver` registry: `directColumn(table)` reads `organization_id` one hop away; `throughForeignKey(table, fk, target)` follows a foreign key into a table that does resolve. Registry seeded with `jobs` (direct) and `job_activities` (indirect → `job_id` → `jobs`). Chains of any depth compose from one-step links.
- **Fails loud, not quiet**: a table absent from the registry **throws** (a programming error), never silently passes. A missing resource, a cross-org resource, and a null `activeOrgId` all return `false` — routes treat all three as a **404** (never 403: a foreign resource must be indistinguishable from a nonexistent one).

**Test — `belongs-to-active-organization.test.ts`** (new): 12 tests in the `evaluate-permission-rule.test.ts` style, reusing `__test-utils__/request-context-fakes.ts` `fakeClient`. Covers direct / `{ jobId }` / indirect locators each crossed against in-org / cross-org / missing, plus the broken-chain (activity's job missing), null-org, and unknown-table-throws cases.

**Verification:** typecheck clean on the changed surface — the only `tsc` error remains the pre-existing unrelated `sync-folder-incremental.test.ts` `TS2322`. Lint clean on both new files. Full suite **354 green / 55 files** (baseline 342 / 54 — +12 tests, +1 file).

**PR [#117](https://github.com/ericdaniels22/Nookleus/pull/117)** opened against `main`, body declares `Closes #97`. Branch pushed to `origin`. Not yet merged — per `feedback_pause_between_issues.md` the session stopped at the PR for review.

## What's next

- **Merge PR #117**; on merge #97 auto-closes and Vercel auto-deploys (no migration, no consumers yet — a no-op deploy).
- **PRD #95 continues** — the guard's consumers are slices **#95/5** (the `expenses` `by-job` / `by-activity` Organization-scoping holes) and **#95/9**. The two expenses routes already exist and were inspected this session: `GET /api/expenses/by-job/[jobId]` takes a job id → `{ jobId }` locator; `GET /api/expenses/by-activity/[activityId]` takes a `job_activities` id → `{ table: "job_activities", id }` indirect locator. Both currently read with the Service client with no org filter.
- Tier 1 of PRD #95 also has the `settings/users/*` gating and the `contract-templates` Organization-scoping hole; Tier 2 is the per-feature-area policy pass.

## Open threads

- **⚠️ Parallel uncommitted work in the main checkout — NOT this session's.** `/Users/vanessavance/Desktop/Nookleus` is currently checked out on branch **`worktree-96-canonical-permission-keys`** (at `21143d2`, no commits yet) with **staged WIP for issue #96** (canonical permission-key vocabulary): new `src/lib/permissions/permission-keys.ts`, modified `evaluate-permission-rule.ts` + `.test.ts`, `src/app/api/settings/users/route.ts`, `src/app/settings/users/page.tsx`. A parallel session owns this — **do not commit it as part of any #97 handoff**.
- **The #97 registry is intentionally minimal** — only `jobs` + `job_activities`. Slices #95/5 and #95/9 each register their own table(s) as they wire up a consumer; the throw-on-unknown-table behavior forces that to be deliberate.
- `belongsToActiveOrganization` is unused until #95/5 / #95/9 — expected for a tracer bullet; it ships as a tested module ahead of its first caller.
- **`00-NOW.md` is bloated** (the body sections are stale at slice #70; only the stacked `last_verified` frontmatter is maintained) — a trim is still overdue.
- Pre-existing typecheck error — `sync-folder-incremental.test.ts` `TS2322`, untouched; filter it from repo-wide typecheck.
- Two crew-password-reset builds remain undocumented in the vault (carried from the #115 handoff).
- Stale worktrees on disk: `.claude/worktrees/84-request-context-settings`, `.claude/worktrees/85-request-context-email-jarvis` (carried from #115), plus `.claude/worktrees/97-active-org-scope-guard` (this session — removable after PR #117 merges) and the #96 worktree the parallel session is using.

## Mechanical state

- **Branch:** session worked in worktree `.claude/worktrees/97-active-org-scope-guard`, branch `worktree-97-active-org-scope-guard`, HEAD `419b181`.
- **`main`:** unchanged this session — still `21143d2` (`vault: salvage #85 request-context handoff doc`).
- **Source commits this session:** one (`419b181`). **Migrations:** none. **Vercel deploy:** none yet (auto-deploys on PR #117 merge).
- **PR:** [#117](https://github.com/ericdaniels22/Nookleus/pull/117) OPEN against `main`; issue #97 still OPEN (closes on merge).
- **Uncommitted in the main checkout:** the staged #96 WIP described in Open threads (parallel session, not this one), plus this handoff file + the `00-NOW.md` update once written, plus untracked `out/`.
- **Note for committing this handoff:** the main checkout is on the `worktree-96-canonical-permission-keys` branch, not `main`. The vault handoff + `00-NOW.md` update normally land on `main` as a vault-only commit — landing them cleanly will need an explicit decision given the branch state and the parallel #96 staging.

## Notes for next session

The guard is the policy-free, I/O-doing counterpart to row-level security for Service-client routes — it sits in `src/lib/request-context/` alongside `withRequestContext` deliberately. When #95/5 wires it into the expenses routes: `by-job` → `belongsToActiveOrganization(ctx.serviceClient, { jobId }, ctx.orgId)`, `by-activity` → `{ table: "job_activities", id: activityId }`; on `false` return **404**, not 403. The route must register any new table in the `RESOLVERS` map first, or the guard throws.

The registry's `throughForeignKey` composes — a table two hops from an Organization just delegates to a resolver that is itself indirect — so deeper indirection needs no new machinery.

## Links

- PRD: [#95](https://github.com/ericdaniels22/Nookleus/issues/95) — Security triage of the ungated logged-in-only endpoints (parent)
- This slice: [#97](https://github.com/ericdaniels22/Nookleus/issues/97) — Active-Organization scoping guard module (OPEN)
- PR: [#117](https://github.com/ericdaniels22/Nookleus/pull/117) — Active-Organization scoping guard (OPEN, `Closes #97`)
- Prior session: [[2026-05-18-115-drop-legacy-name-columns]]
- Current state: [[00-NOW]]
