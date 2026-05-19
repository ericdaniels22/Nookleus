---
date: 2026-05-18
build_id: request-context
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-18-121-gate-knowledge-delete]]", "[[2026-05-18-119-notifications-idor]]", "[[2026-05-18-101-org-scope-expenses]]"]
---

# Build request-context Handoff — 2026-05-18 (thirty-second session — **PRD #95 triage bug #120 IMPLEMENTED via `/tdd`, MERGED to `main` ([PR #132](https://github.com/ericdaniels22/Nookleus/pull/132), `fc4b9d7`); issue #120 CLOSED. PRD #95 is now fully delivered.**)

## What shipped this session

**Slice #120 — org-scope the Jarvis chat + tool data queries.** Bug [#120](https://github.com/ericdaniels22/Nookleus/issues/120), the last of the three #99-triage-spun bugs under PRD [#95](https://github.com/ericdaniels22/Nookleus/issues/95). `POST /api/jarvis/chat` and the executors in `@/lib/jarvis/tools` run on the Service client (RLS bypassed) but queried org data with **no `organization_id` filter**: the general-context business snapshot summed `jobs` / `invoices` / `payments` / `job_activities` **platform-wide** into the Jarvis system prompt, and job lookups (route job-context branch, `get_job_details`, the parent-job lookups in `log_activity` / `create_alert`) loaded a job by `job_id` alone regardless of tenant. Same class of cross-tenant data-scoping bug as #79/#101.

The fix scopes every Jarvis data query to the caller's Active Organization:

- **`src/app/api/jarvis/chat/route.ts`** — the business-snapshot reads (the three `jobs` queries plus `invoices`, `payments`, `job_activities`) and the job-context lookup take `.eq("organization_id", ctx.orgId)`; `ctx.orgId` is threaded into the tool execution context.
- **`src/lib/jarvis/tools.ts`** — `ToolExecutionContext` gains a **required** `orgId: string | null`. `get_job_details` / `search_jobs` / `get_business_metrics` scope their reads; `log_activity` / `create_alert` scope their parent-job lookup so a `job_id` from another tenant reads as "not found" and is never written across the boundary. `consult_rnd` / `consult_marketing` query no org data — unchanged.
- The logged-in-only auth gate (`{ serviceClient: true }`) is **unchanged** — Jarvis is a company-wide assistant, no permission key carves it; no key introduced.

Built with `/tdd`, tracer-bullet first — one RED→GREEN cycle per behavior. New `src/lib/jarvis/tools.test.ts` (the file did not exist before): 6 tests covering org scoping for each data tool — `get_job_details` foreign-job rejected / in-org returned, `search_jobs` org-only, `get_business_metrics` org-only counts+revenue, `log_activity` refuses a foreign job, `create_alert` won't adopt a foreign job's org. The `create_alert` test first passed for the wrong reason (the unscoped path crashed on an unseeded `jarvis_alerts` table); it was reseeded so the leak path produces a real success → genuine RED → GREEN.

`docs/request-context-ungated-endpoints.md` — a `> **#120 — scoped.**` resolution note added under the `## #99` triage section's Jarvis-chat flag.

Source `64ba996`, merged `--no-ff` as `fc4b9d7` ([PR #132](https://github.com/ericdaniels22/Nookleus/pull/132)); branch + worktree deleted. 4 files, +199/−6. No migration; Vercel auto-deploys on merge.

Verification: full suite **664 green / 111 files** (post-rebase, includes the 6 new). Typecheck clean on the changed surface (only the pre-existing `sync-folder-incremental.test.ts` `TS2322` remains). Lint: `tools.ts:355` carries a pre-existing `@typescript-eslint/no-explicit-any` (`(ja: any)`) — `git diff` confirms it is untouched by this slice; left as-is per the repo convention for pre-existing issues.

## What's next

- **Close the umbrella issue [#95](https://github.com/ericdaniels22/Nookleus/issues/95).** PRD #95 is now fully delivered — gating/scoping slices #96–#107 and the three #99-triage bugs #119 + #120 + #121 are all merged. #95 was kept OPEN only for its remaining triage bugs; with #120 closed there is nothing left. It should be closed (verify nothing else is tracked under it first).
- **`tools.ts:355` pre-existing `any`** — `(ja: any)` in `toolGetJobDetails`. `route.ts` already defines a `JobAdjusterRow` interface for exactly this shape; a future cleanup could lift it into `tools.ts`. Out of #120 scope, not done.

## Decisions locked

- **Test scope for #120: tools tests only** (user-selected via AskUserQuestion). The route fix applies the identical `.eq("organization_id", ctx.orgId)` pattern but is **not** unit-tested — the route's data-scoping is observable only through the mocked Anthropic SDK, so a route test would mean a heavy SDK-mock surface for a behavior already covered structurally by the tool tests. The route change was still required for typecheck (the new required `ToolExecutionContext.orgId`).

## Open threads

- **`worktree-121-gate-knowledge-delete` worktree still present** in `.claude/worktrees/` (a concurrent session's, branch `worktree-121-gate-knowledge-delete` at `05f62f8`). #121 is merged (PR #131); the worktree looks like leftover cleanup that the #121 session did not run. Safe to `git worktree remove` if confirmed stale.
- `00-NOW.md` is still bloated — only the stacked `last_verified` frontmatter is maintained; a trim is overdue (carried).
- Pre-existing, untouched, filter from any repo-wide check: `sync-folder-incremental.test.ts` `TS2322`; `react-hooks/set-state-in-effect` at `settings/users/page.tsx:94`; `no-explicit-any` at `jarvis/tools.ts:355` (carried).

## Mechanical state

- **Branch:** `main` (the `worktree-120-org-scope-jarvis-queries` branch + worktree were deleted post-merge).
- **Commit at session end:** `4ac3420` (Merge pull request #131 — #121 gate knowledge document DELETE; the #120 merge `fc4b9d7` and source `64ba996` are two commits behind it on `main`).
- **Uncommitted changes:** none (the vault handoff commit aside; `out/` is an untracked build dir).
- **Migrations applied this session:** none — #120 is a query-scoping fix.
- **Deployed to Vercel:** auto-deploys on the #132 merge to `main`.

## Notes for next session

#120 is a pure data-scoping tightening — the gate and the route bodies are unchanged, only the queries gained an `organization_id` filter. `main` advanced twice mid-session (#106 PR #129, then #119 PR #130, then #121 PR #131 all landed from concurrent sessions); the #120 branch was cut from `origin/main` at `24e5b72`, then rebased onto the latest `origin/main` with a clean auto-merge of the shared `docs/request-context-ungated-endpoints.md` (the #106/#119/#120/#121 sections append at different points). With #120 merged, **PRD #95 — the security triage of the ungated logged-in-only endpoints — is complete**: every slice and every triage bug shipped. The natural next move is to close umbrella issue #95 and pick up whatever is next in the backlog.

## Links

- PRD: [#95](https://github.com/ericdaniels22/Nookleus/issues/95) — Security triage of the ungated endpoints (now fully delivered)
- This session's slice: [#120](https://github.com/ericdaniels22/Nookleus/issues/120) (PR [#132](https://github.com/ericdaniels22/Nookleus/pull/132))
- Sibling triage bugs: [[2026-05-18-119-notifications-idor]], [[2026-05-18-121-gate-knowledge-delete]]
- Current state: [[00-NOW]]
