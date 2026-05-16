---
date: 2026-05-16
build_id: request-context
session_type: architecture-planning
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-15-76-template-hard-delete-implemented]]"]
---

# Build request-context Handoff — 2026-05-16 (seventeenth session, architecture review → candidate #1 "Request Context" grilled, PRD #78 filed, broken into 8 slice issues #79–#86 — no source commits)

## What shipped this session

No source commits, no migrations, no Vercel deploy. This was an architecture-planning session.

- **Ran `/improve-codebase-architecture`.** Two parallel `Explore` sweeps over `src/lib/` + `src/app/api/` and `src/components/` + page files. Surfaced **7 deepening candidates**: (1) a missing authenticated request-context module under ~166 route handlers; (2) three near-copies of email send; (3) the monolithic QuickBooks sync processor; (4) contract auto-fill orchestration trapped in routes; (5) money math locked in the 2,302-line EstimateBuilder; (6) the repeated async-action pattern across list components; (7) payment-request validation trapped in its route.
- **Picked candidate #1 and grilled it (`/grill-me`)** to shared understanding. Design decisions locked:
  1. The module hands back a **full context bundle** (`{ userId, orgId, role, supabase }`), not a yes/no gate.
  2. **User client** always; **Service client** opt-in only (`serviceClient: true`) — the RLS-bypass tool stays visible.
  3. **One function, settings-object rule** — `{ permission: "key" }` / `{ permission: [...] }` / `{ adminOnly: true }` / `{}`.
  4. **Wrapper style** — an endpoint is *handed to* `withRequestContext`; on denial the wrapper sends the rejection and the handler never runs, so the deny-check cannot be forgotten.
  5. **Behavior-preserving conversion** — gated routes map 1:1, ungated routes wrapped logged-in-only; the work *produces a list* of ungated endpoints for a separate triage follow-up. No access rules tightened here.
  6. **Build module first, then convert in feature-area batches**; old gates deleted last; old + new coexist meanwhile.
- **Created `CONTEXT.md`** at the repo root (new file) — the project's first code-domain glossary, defining **Organization**, **Active Organization**, **Request Context**, **User client**, **Service client**.
- **Filed the PRD as [issue #78](https://github.com/ericdaniels22/Nookleus/issues/78)** (`ready-for-agent`) — "Request Context: one auth/org-scoping wrapper to replace the four route gates". Modules: `evaluate-permission-rule` (pure decision function) + `withRequestContext` (wrapper). All three test layers selected by Eric (pure function, wrapper, converted routes).
- **Ran `/to-issues`** — broke #78 into **8 vertical-slice issues #79–#86**, all `ready-for-agent`:
  - **#79** (HITL) — tracer: build both modules + all three test suites + convert the `expenses` endpoints. No blockers.
  - **#80–#85** (AFK) — conversion batches, each blocked by #79: #80 contracts + item-library; #81 invoices + estimates; #82 accounting + QuickBooks; #83 jobs + payments + payment-requests; #84 settings; #85 email + Jarvis + remaining.
  - **#86** (AFK) — delete the four old gates + publish the ungated-endpoint list; blocked by #80–#85.

## What's next

- **#79 is the only unblocked issue** — it builds `evaluate-permission-rule` + `withRequestContext` and proves them on the `expenses` routes. Implement it next; on merge, #80–#85 all become grabbable in parallel.
- Per `feedback_pause_between_issues.md` the issues were filed but not started.
- Still queued, untouched: **#58 umbrella** has #62 (Restore voided) + #63 (Permanently delete voided) `ready-for-agent`; the **#68 real-email demo** remains on Eric's plate.

## Open threads

- **Drift corrected at orientation.** The sixteenth-session handoff recorded PR #77 as OPEN with `main` at `def65df`. PR #77 has since merged — `main` HEAD is now `3cab99e` and issue #76 auto-closed. The archived sixteenth-session entry in `00-NOW.md` is a historical snapshot and was left as-was.
- **Ungated endpoints are a known potential security gap.** `settings/*`, `payments/*`, and others currently have no permission check. The #78 work wraps them logged-in-only (no behavior change) and #86 produces the list; *tightening* them is a deliberate separate follow-up, out of scope for #78.
- **Pre-existing soft-archive `DELETE` gap** on `/api/settings/contract-templates/[id]` (the "Archive" action) still lacks `requirePermission` + an org filter — will surface in the #84 settings batch's ungated list.
- **Pre-existing unrelated typecheck error** — `src/lib/email/sync-folder-incremental.test.ts` `TS2322`, untouched; filter it from repo-wide typecheck.

## Mechanical state

- **Branch:** `main`.
- **HEAD:** `3cab99e` (`Merge pull request #77 …`) — unchanged by this session's planning work; the merge happened between sessions.
- **Source commits this session:** none. **Migrations:** none. **Vercel deploy:** none.
- **Uncommitted changes:** new `CONTEXT.md`, the `00-NOW.md` edit, and this handoff file — to be committed and pushed to `main` per Eric's request. Gitignored `out/` present as always.
- **GitHub:** 1 PRD issue (#78) + 8 slice issues (#79–#86) created, all `ready-for-agent`. No issues closed by this session.

## Notes for next session

- **The deep, testable seam is the #1/#2 split.** All access-control *judgment* lives in `evaluate-permission-rule` as a pure function (test exhaustively, no mocks); `withRequestContext` is just I/O plumbing around it.
- **`CONTEXT.md` is now live** at the repo root — the architecture and PRD vocabulary (Organization / Active Organization / Request Context / User client / Service client) all trace to it. Future architecture work should extend it rather than reinvent terms.
- **The remaining 6 architecture candidates** (#2–#7 above) were surfaced but not pursued — email-send consolidation, QB sync processor, contract auto-fill orchestration, EstimateBuilder money math, the async-action component pattern, payment-request validation. They're a ready backlog for future `/improve-codebase-architecture` follow-ups.

## Links

- PRD: [#78](https://github.com/ericdaniels22/Nookleus/issues/78) — Request Context wrapper (parent)
- Slices: [#79](https://github.com/ericdaniels22/Nookleus/issues/79) (tracer) · [#80](https://github.com/ericdaniels22/Nookleus/issues/80) · [#81](https://github.com/ericdaniels22/Nookleus/issues/81) · [#82](https://github.com/ericdaniels22/Nookleus/issues/82) · [#83](https://github.com/ericdaniels22/Nookleus/issues/83) · [#84](https://github.com/ericdaniels22/Nookleus/issues/84) · [#85](https://github.com/ericdaniels22/Nookleus/issues/85) · [#86](https://github.com/ericdaniels22/Nookleus/issues/86) (cleanup)
- Prior session: [[2026-05-15-76-template-hard-delete-implemented]]
- Current state: [[00-NOW]]
