---
date: 2026-05-15
build_id: template-hard-delete
session_type: exploratory
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-14-70-autofill-checkboxes-shipped]]", "[[build-15d]]"]
---

# Build template-hard-delete Handoff — 2026-05-15 (fifteenth session, contract-template permanent-delete design grilled + PRD filed as issue #76 — no code)

## What shipped this session

- **No source commits.** Planning/design session. Two artifacts produced: a `00-NOW.md` vault edit and **[GitHub issue #76](https://github.com/ericdaniels22/Nookleus/issues/76) — "Permanently delete contract templates"**, filed via `/to-prd` and labeled `ready-for-agent`.
- **`00-NOW.md` brought current.** It was stale four sessions back (frontmatter still read "twelfth session — #66 drag-to-pan"). Added a fourteenth-session `last_verified` entry covering #69 + #70 + PRD #65 fully delivered, archived the prior #66 entry below it with a note that the thirteenth-session #69 entry was never separately stamped and is rolled into the fourteenth entry. (This handoff adds the fifteenth-session entry on top — see Mechanical state.)
- **Issue #76 PRD content** — permanent/hard delete for contract templates. Grilled to shared understanding via `/grill-me` before filing. The four user-facing decisions (see "Decisions locked") plus the technical shape: FK migration, a `hard_delete_contract_template` RPC, two new endpoints, signing-view graceful degradation, and tests on all four testable pieces.

## What's next

- **Issue #76 is `ready-for-agent`** — fully specified, an AFK agent (or the next session) can pick it up directly. No blockers. Per `feedback_pause_between_issues.md` this was filed but not started; implementation is a deliberate next step, not auto-advanced.
- Implementation order implied by the PRD: FK migration → `template-deletion-eligibility` pure module (TDD) → `hard_delete_contract_template` RPC → the two routes → signing-view degradation → templates-list UI.
- Still open from prior sessions (unchanged, not touched this session): **#58 umbrella void/restore/delete** has #62 (Restore voided) and #63 (Permanently delete voided) `ready-for-agent`; the **#68 real-email demo** is on Eric's plate.

## Decisions locked

All four confirmed explicitly by Eric this session during the `/grill-me` walk:

- **Delete is blocked only while a customer is mid-signing.** A template referenced by a `sent` or `viewed` contract cannot be deleted; every other case is allowed, including templates with a history of signed contracts. Eric's framing: a signed contract is already saved as its own PDF, so history must not protect a template — only work-in-progress does.
- **Unsent `draft` contracts cascade-delete with the template.** Confirmed "b" — drafts go away with the template (the confirm dialog discloses the count) rather than blocking the delete.
- **Signed contracts' original signing links keep working.** Confirmed "b" — after a template is deleted, an already-`signed` contract's old signing link still serves the stamped `signed_pdf_path` instead of erroring. Requires graceful degradation in `build-public-signing-view.ts`.
- **One-step UI.** Confirmed "a" — "Delete permanently" lives directly in the templates-list `⋯` menu with a confirmation popup; no archive-first two-step.
- **Test scope** — Eric selected all four testable pieces: the eligibility module, the RPC, the usage endpoint, and the signing-view degradation.

## Open threads

- **FK migration is unwritten.** The PRD specifies `contracts.template_id` → drop `NOT NULL` + FK `ON DELETE SET NULL`. Per `feedback_supabase_mcp_prod_migration_approval.md` the migration SQL must be surfaced for a plain-text "yes apply" before `apply_migration` runs. Not done — it is implementation work for the #76 agent.
- **`Contract.template_id` type ripple.** Making the FK nullable flips `Contract.template_id` from `string` to `string | null` in `src/lib/contracts/types.ts:104`. Consumers to touch: `build-public-signing-view.ts` (two load sites), `sign/[token]/route.ts:159`, `in-person/route.ts:64`. The report/estimate `template_id` columns are unrelated tables — leave them.
- **Pre-existing soft-archive `DELETE` gap.** `DELETE /api/settings/contract-templates/[id]` (the "Archive" action) lacks both `requirePermission` and an org filter, unlike `POST`/`PATCH`/`duplicate`. The PRD explicitly leaves this as-is and notes tightening it as a separate follow-up — flagged here so it is not forgotten.
- **`00-NOW.md` is a single-growing-paragraph log.** Each session's state is one dense `last_verified:` frontmatter line; prior ones are stacked below behind `ARCHIVED` markers. The thirteenth-session #69 entry was skipped entirely (never stamped) — a reminder that 00-NOW can silently fall behind the handoffs. The handoffs in `docs/vault/handoffs/` remain the per-session ground truth.

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `4632045` (`Merge pull request #75 from ericdaniels22/claude/70-autofill-checkboxes`) — HEAD did not move this session; no source commits.
- **Uncommitted changes:** `docs/vault/00-NOW.md` (modified — the fourteenth-session entry added earlier this session, plus the fifteenth-session entry added by this handoff) and the new handoff file. Gitignored `out/` present as always.
- **Migrations applied this session:** none.
- **Deployed to Vercel:** n/a — no code changed.
- **GitHub:** issue #76 created, labeled `ready-for-agent`. No issues closed.

## Notes for next session

- **Issue #76 is the carryable artifact.** It is self-contained — Problem / Solution / 18 user stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes. The next session can implement straight from it without re-deriving anything.
- **The deep module is `template-deletion-eligibility`.** Pure function — input the referencing contracts as `{ id, status }`, output `{ deletable, blockers, draftIds }`. No DB. It is the single place the rule lives; build it first via `/tdd` and the rest is plumbing. Prior art for the test style: `auto-checkbox-evaluator.test.ts`, `restore-target-status.test.ts`.
- **The RPC re-checks eligibility at delete time.** The `GET …/usage` endpoint is advisory (feeds the dialog its counts); the `hard_delete_contract_template` RPC is the authoritative gate so a contract that flips to `sent` between dialog-open and confirm cannot slip through. Keep that split.
- **Graceful degradation only matters for `signed` contracts.** `voided` and `expired` contracts short-circuit in `build-public-signing-view.ts` *before* the template load, so they need no change. Only the `signed`-status path currently loads the template and would 404 once it is null.
- **Realistic primary use case:** clearing blank `Untitled Template (N)` rows left from smoke testing — those have zero referencing contracts and hit the simplest deletable path. The mid-signing-block path is currently exercisable only with test contracts (`project_no_real_customers_yet.md`).
- This session also confirmed the contracts-template-builder PRD (#65) is fully delivered — #66–#70 all merged. #76 is a net-new initiative on the same surface, not a sixth slice of #65.

## Links

- PRD / issue: [#76](https://github.com/ericdaniels22/Nookleus/issues/76) — Permanently delete contract templates (`ready-for-agent`)
- Prior session: [[2026-05-14-70-autofill-checkboxes-shipped]]
- Current state: [[00-NOW]]
- Related: [[build-15d]] (contract template overlay builder)
