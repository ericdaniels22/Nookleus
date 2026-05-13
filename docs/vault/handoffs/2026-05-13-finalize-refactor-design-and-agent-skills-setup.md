---
date: 2026-05-13
build_id: standalone (no build — design + tooling)
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-11-build-65b.2-final-polish-and-merge]]", "[[build-15h]]"]
---

# Finalize-refactor design + agent-skills setup — 2026-05-13

## What this session was

A standalone session that did **not advance any specific build**. Two pieces of work, both pushed to `main`:

1. **Agent-skills tooling setup** via the `/setup-matt-pocock-skills` skill — wired GitHub as the issue tracker, locked the canonical five-label triage vocabulary, declared the single-context domain-doc layout. Skills like `/to-prd`, `/triage`, `/to-issues`, `/diagnose`, `/tdd`, `/improve-codebase-architecture` now read from `docs/agents/`.
2. **Design + PRD for a `finalizeSignedContract` refactor**, produced via the `/improve-codebase-architecture` grilling loop. Picks up the silent `contracts.update(...)` failure deferred from 15h, plus two structural problems alongside it. Spec landed in `docs/superpowers/specs/`; published as GitHub issue #57 with the `ready-for-agent` label so a future AFK agent can pick it up.

No code was changed in `src/`. No migrations. No Vercel deploys (docs-only changes don't trigger one). No TestFlight push.

## Agent-skills config (commit `e76a00d`)

- `CLAUDE.md` gained an `## Agent skills` section pointing at `docs/agents/{issue-tracker,triage-labels,domain}.md`.
- `docs/agents/issue-tracker.md` — `gh` CLI conventions for create/read/list/comment/label/close.
- `docs/agents/triage-labels.md` — canonical five-label table (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). The right-hand column matches the left; edit later if you want a custom vocabulary.
- `docs/agents/domain.md` — single-context layout: `CONTEXT.md` + `docs/adr/` at repo root. Neither exists yet; the consumer rules say skills should proceed silently when absent, so this is a zero-cost declaration.
- New GitHub label `ready-for-agent` created (color `0E8A16`, deep green) and applied to issue #57.

## Architecture review → finalize refactor

The `/improve-codebase-architecture` Explore pass surfaced **five deepening opportunities**:

1. Upload-queue state machine spread across worker + provider effect.
2. **`contracts/finalize.ts` welds the transactional flip onto best-effort email.** ← picked
3. Route-classification rules duplicated across `proxy.ts` and `app-shell.tsx`.
4. `camera-view.tsx` doing four jobs in one ~552-line file.
5. CryptoVault: key lifecycle and encryption share an interface with no readiness signal.

Rationale for picking #2 over #1 (the higher-leverage developer-experience candidate): contract signing is the load-bearing product surface, and the `no real customers yet` window is the cheap moment to fix audit-trail integrity. ESIGN/UETA forensics becomes load-bearing the moment a real customer signs; backfilling audit-row consistency after that is not possible.

### The three problems being fixed

1. **Silent status-flip failure.** `contracts.update(...)` at `src/lib/contracts/finalize.ts:108` has no error check. If the update fails (RLS denial, network blip, constraint violation), the function continues into the email block and returns success while the contract is still not flagged as signed in the DB. Reviewers flagged this as IMPORTANT during 15h's subagent review and it was deferred for plan-fidelity.
2. **Double emails on route retry.** PDF upload (`upsert: true`) and status flip are idempotent; emails are not. A retried request sends the customer two "thanks for signing" emails.
3. **Inconsistent audit-row shape.** Three nested catches all write `contract_events` rows. The `metadata.kind` depends on which catch caught the throw, so a failure in the internal-email section can land in the audit log labelled `customer_confirmation`. The "settings missing" branch writes one row and never records the internal email's intended outcome.

### Decisions locked via the grilling loop

- **One public function, same name.** `finalizeSignedContract` keeps its name and both callers (`/api/sign/[token]` and `/api/contracts/in-person`). The change is internal structure + a richer return value. Both routes always need both halves (seal + notify); splitting the function would add boilerplate without unlocking value.
- **Refuse-to-run-twice idempotency.** First action inside the function is to read `contracts.status`; if already `signed`, return immediately with `wasAlreadyFinalized: true` and the existing PDF path. No re-stamp, no re-flip, no emails. "Smart partial-retry recovery" (resending the emails that failed last time) is **explicitly out of scope** — that's a future, separate manual-resend flow.
- **Error-checked status flip.** The DB update gets the same error treatment as every other failure point in the pipeline: throws on failure, emails never dispatch.
- **Internal structure: two private helpers.** `sealContract` owns the transactional half (download signatures + source PDF, stamp, upload, flip status; throws). `dispatchNotifications` owns best-effort emails (settings load, per-signer customer email, internal email, audit-row writes; never throws out). Public function is a thin orchestrator.
- **Audit-row shape: medium with `console.error` fallback.** Every intended recipient produces exactly one `contract_events` row with a unified outcome shape — `sent` carries `{kind, signer_id?, provider, message_id}`, `failed` carries `{kind, signer_id?, error}`, `skipped` carries `{kind, signer_id?, skipped_reason}` (one of `settings_missing`, `no_internal_recipient`, `no_signer_email`). When `writeContractEvent` itself fails, a structured `console.error` lands in Vercel logs with enough context to reconstruct the intended row. **Vercel logs as the durable record is a deliberate `no real customers yet` decision** — a durable secondary fallback (separate table, structured-logging pipeline) is filed for a future hardening pass when real customers exist.
- **Return shape: rich, with summary + per-recipient outcomes + no-op flag.**
  ```ts
  { signedPdfPath, wasAlreadyFinalized,
    notifications: { summary: {sent, failed, skipped},
                     outcomes: Array<{recipient, signerId?, to, result}> } }
  ```
  When `wasAlreadyFinalized` is true, `outcomes` is empty and `summary` is all zeros.
- **Already-signed returns a normal result, not an exception.** Retrying a successful operation isn't an error. Caller checks the flag if it cares, ignores it otherwise.

### What got written (commit `5c105e3`)

`docs/superpowers/specs/2026-05-13-finalize-signed-contract-refactor-design.md` (~146 lines):

- Problem statement covering all three failure modes.
- Behavioural changes section (idempotency, error check, return shape, audit-row contract, logging fallback).
- Internal structure (two private helpers in the same file).
- Test list — six tests this refactor unlocks, all impossible against today's code (status-flip failure throws; already-signed returns no-op; mixed-outcome dispatch; settings missing → all-skipped rows; internal-unresolvable; signer-with-null-email).
- Test infrastructure note: build an in-file Supabase fake scoped to the calls finalize actually makes (same pattern as the 65c `localStorage` stub via `Object.defineProperty`). Don't pull in a general-purpose mock.
- Eight-step work order. **Steps 1–2 (idempotency + error-checked update) are the load-bearing safety fixes and could ship as their own commit** if the executor prefers separating them from the structural refactor.
- Risks section: (a) Supabase fake shape, (b) Vercel-logs-only fallback is temporary, (c) the early-return assumes the only way into `status: signed` is through this function — fine today, worth noting for future admin tools.

### What got published

GitHub issue **#57** — `Refactor: harden contract finalize — idempotency, error-checked status flip, unified audit rows` — with the `ready-for-agent` label. Full PRD body produced via `/to-prd`. Links back to the design spec in the "Further Notes" section. URL: https://github.com/ericdaniels22/Nookleus/issues/57.

## Open threads (none are 65b.2 regressions)

- **Implement #57 / the finalize refactor.** Spec is sized for one session via `superpowers:subagent-driven-development` or as direct implementation. Eight-step work order in the spec; first two steps are the load-bearing safety fixes.
- **TestFlight push** — still deferred from 65a. Apple Dev Program enrolled (since 2026-05-11). Nothing blocking but available session time.
- **Portrait-lock Info.plist commit (`63bc89e`)** needs an Xcode rebuild to take effect.
- **Finding-B regression test** (red pulsing dot on real upload failures via airplane mode → retry-exhaustion) — visually verified, not airplane-mode-tested.
- **65b.1 follow-up list** (~6 items inherited).
- **Step 5 Supabase email templates** — inherited.
- **AAA QB sandbox token** — expired 2026-04-21, inherited.
- **67c2 reviewer F4–F8** + **5xx redactor sweep across remaining ~80 routes** — inherited.

## Mechanical state at session end

- **Branch:** `main`
- **HEAD:** `5c105e3` (`docs(contracts): design spec for finalize refactor`)
- **`origin/main`:** `5c105e3` (pushed)
- **Two commits this session** on top of `aa879b6` (the 65b.2 merge commit):
  - `e76a00d` `chore(agents): wire up Matt Pocock engineering-skills config`
  - `5c105e3` `docs(contracts): design spec for finalize refactor`
- **Working tree:** clean except gitignored `out/`.
- **Migrations:** none applied.
- **Vercel deploys:** none (docs-only changes don't trigger a build).
- **TestFlight pushes:** none.
- **GitHub state:** issue #57 opened with `ready-for-agent` label; the label itself was newly created (color `0E8A16`, green).
- **Memories saved this session:** none — design decisions live in the spec + this handoff, which is the right home.

## Notes for the next session

- **The handoff doc is being added in a separate vault commit after this session's work was already pushed.** The vault commit will be 3rd on `main` past the 65b.2 merge. No PR; lands directly on `main` per existing handoff pattern.
- **Build numbering for the implementation.** The finalize refactor doesn't have a build card yet. The next session can either (a) create `build-15j.md` or similar for the implementation and treat issue #57 as the spec, or (b) skip the build card entirely since the issue + design spec already specify the work. Eric's call.
- **Subagent-driven-development fits this work well.** The spec's eight-step order is tractable for an implementer subagent at each step, with spec-compliance + code-quality review on the structural changes. Steps 1–2 are small enough to skip formal reviewer dispatch.
- **First execution risk** is the in-file Supabase fake — finalize calls four distinct Supabase surfaces (`.from(...).select`, `.update`, `.maybeSingle`; `.storage.from(...).download`, `.upload`; `.insert` via `writeContractEvent`). Worth scoping the fake before sinking into Task 1 of the spec.

## Links

- **Design spec:** `docs/superpowers/specs/2026-05-13-finalize-signed-contract-refactor-design.md`
- **GitHub issue:** [#57](https://github.com/ericdaniels22/Nookleus/issues/57)
- **File being refactored:** `src/lib/contracts/finalize.ts`
- **Callers (will get tiny touch):** `src/app/api/sign/[token]/route.ts`, `src/app/api/contracts/in-person/route.ts`
- **Origin of the silent-update bug:** 15h handoff `[[2026-05-07-build-15h-implementation]]`
- **Agent-skills config files:** `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`
- **Predecessor handoff:** [[2026-05-11-build-65b.2-final-polish-and-merge]]
- **Current state:** [[00-NOW]]
