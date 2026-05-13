---
date: 2026-05-13
build_id: standalone (no build card — issue #57 + design spec already specified the work)
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-13-finalize-refactor-design-and-agent-skills-setup]]"]
---

# Finalize-refactor implementation — 2026-05-13 (afternoon)

## What this session was

Second session of 2026-05-13. The morning produced the design spec and
GitHub issue #57; this session **implemented #57 via `/tdd`**. Single
commit `83b5312` landed on `main`. Issue #57 closed.

Per the morning handoff's open question — "create `build-15j.md` or
skip the build card entirely since the issue + design spec already
specify the work" — went with **option (b)**: no build card. The issue
and the design spec at
`docs/superpowers/specs/2026-05-13-finalize-signed-contract-refactor-design.md`
are the durable record.

## What got built (commit `83b5312`)

`refactor(contracts): harden finalize — idempotency, error-checked flip, unified audit rows`

Four files changed (+1086, −133):

- **`src/lib/contracts/finalize.ts`** — full rewrite of the public function
  as a thin orchestrator over two new private helpers.
- **`src/lib/contracts/finalize.test.ts`** — new test file, 7 tests, 783
  lines including the in-file Supabase fake.
- **`src/app/api/sign/[token]/route.ts`** — captures `finalizeResult`,
  `console.warn`s on any non-sent outcome. HTTP response unchanged.
- **`src/app/api/contracts/in-person/route.ts`** — same.

### The three fixes (matching the spec)

1. **Idempotency early-return.** `finalizeSignedContract` now reads
   `contracts.status` and `signed_pdf_path` from the DB as its first
   action. If status is already `'signed'` and a signed PDF path
   exists, returns immediately with `wasAlreadyFinalized: true`, the
   existing PDF path, and an empty notifications block. No re-stamp,
   no re-flip, no emails. "Refuse to run twice" semantics — manual
   resend of failed emails remains a future flow.

2. **Error-checked status flip.** The `contracts.update(...)` call at
   the end of `sealContract` now captures `{ error }` and throws if
   the update failed. Closes the silent-failure bug deferred from
   15h's reviewer findings. Emails never dispatch on a failed seal.

3. **Unified audit-row metadata.** Every intended recipient produces
   exactly one `contract_events` row with metadata of one of three
   shapes:
   - `sent: { kind, signer_id?, provider, message_id }`
   - `failed: { kind, signer_id?, error }`
   - `skipped: { kind, signer_id?, skipped_reason }` where
     `skipped_reason ∈ { settings_missing, no_internal_recipient, no_signer_email }`

   The old behavior (one row labelled `customer_confirmation` regardless
   of which catch caught the throw) is gone. When the audit-write
   itself fails, a structured `console.error("[finalize] audit row
   write failed", { contractId, kind, signerId, originalOutcome,
   auditError })` lands in Vercel logs — the deliberate
   `no real customers yet` temporary fallback per
   `project_no_real_customers_yet.md`.

### Internal structure

The public `finalizeSignedContract` is now a thin orchestrator (~25
lines) over two private helpers in the same file:

- **`sealContract(args): Promise<SealResult>`** — transactional half.
  Downloads signature PNGs + source template PDF, resolves merge
  values, stamps the PDF, uploads it, flips status. Throws on any
  failure. Returns `{ signedPdfPath, stampedPdfBytes }`. No email
  logic, no audit-row writes.
- **`dispatchNotifications(supabase, contract, signers, stampedPdfBytes)`**
  — best-effort half. Loads `contract_email_settings`, dispatches
  per-signer customer emails + one internal email, writes one audit
  row per intended recipient via the `recordOutcome` helper. **Never
  throws out** — failures land in the returned outcomes list (and
  audit rows) instead.

Plus a small `recordOutcome(supabase, contractId, outcome)` helper
that translates a `NotificationOutcome` into the unified
`contract_events` row shape and handles audit-write failures with the
`console.error` fallback.

### New return shape

```ts
export interface FinalizeResult {
  signedPdfPath: string;
  wasAlreadyFinalized: boolean;
  notifications: {
    summary: { sent: number; failed: number; skipped: number };
    outcomes: Array<{
      recipient: "customer" | "internal";
      signerId?: string;
      to: string | null;
      result:
        | { status: "sent"; provider: string; messageId: string }
        | { status: "failed"; error: string }
        | { status: "skipped"; reason: SkippedReason };
    }>;
  };
}
```

Both callers (`/api/sign/[token]`, `/api/contracts/in-person`) capture
the result and `console.warn("[sign|in-person] finalize notifications
had non-sent outcomes", { contract_id, was_already_finalized, summary })`
when `summary.failed > 0 || summary.skipped > 0`. **HTTP response shape
is unchanged** — the warn-log is the only caller-side observable.

## Test file (`src/lib/contracts/finalize.test.ts`)

In-file Supabase fake scoped to **exactly** what finalize touches
(no general-purpose mock pulled in): `.from(...).select.eq.limit.maybeSingle`
chains, `.update.eq`, `.insert`, plus `storage.from(...).download/upload`.
Tracks every insert, update, and storage upload so assertions can
walk the recorded calls. External dependencies are `vi.mock`ed at
the module level (`./stamp-pdf`, `./resolve-merge-values`,
`./email-merge-fields`, `./email`).

Seven tests, covering every scenario in the spec:

- `idempotency` — already-signed contract → no-op, no DB writes, no
  emails, `wasAlreadyFinalized: true`.
- `happy path return shape` — one signer + internal both sent →
  `summary: {sent: 2, failed: 0, skipped: 0}`, two outcomes with
  correct provider/messageId, two audit rows with matching metadata.
- `mixed-outcome dispatch` — two signers, one customer email throws
  → `summary: {sent: 2, failed: 1, skipped: 0}` (one customer +
  internal sent, one customer failed); three audit rows, the failed
  one carrying `error: '550 mailbox unavailable'`.
- `settings missing` — `contract_email_settings` row absent → contract
  still sealed (status flip happened), one skipped row per intended
  recipient (one per signer + one internal), all
  `skipped_reason: 'settings_missing'`, no emails attempted.
- `no internal recipient resolved` — `resolveInternalRecipient`
  mocked to return `""` → internal outcome is `skipped` with
  `reason: 'no_internal_recipient'`; customer still sent.
- `signer with null email` — first signer has empty `email` → that
  signer skipped with `reason: 'no_signer_email'`; other signer + internal
  still attempted; `summary: {sent: 2, failed: 0, skipped: 1}`.
- `error-checked status flip` — `contracts.update` returns an error
  → function throws, `sendContractEmail` not called, no rows in
  `contract_events`.

### Test infrastructure decisions

- **`NEXT_PUBLIC_APP_URL` stubbed via `vi.stubEnv` in `beforeAll`** —
  the internal-email path calls `appUrl()` to build the
  `contract_platform_url` merge value; without the stub the call
  throws and every internal-email test fails as "1 sent, 1 failed".
  Caught it in cycle 3 (happy path).
- **Module-mock implementations re-set in a top-level `beforeEach`** —
  `vi.clearAllMocks()` clears call history but **preserves**
  implementations, so a test that does
  `vi.mocked(resolveInternalRecipient).mockReturnValue("")` leaks
  into the next test. The beforeEach re-stamps the defaults
  (`sendContractEmail → resend/msg-stub`,
  `resolveInternalRecipient → "internal@example.com"`).
- **Supabase fake is in-file** per the spec's recommendation — not a
  shared helper module. Self-contained file.

### Test results

- Finalize tests: **7/7 passing.**
- Full repo: **27/27 tests pass.** One pre-existing transform failure
  in `src/lib/mobile/use-capture-mode.test.ts` (missing
  `@testing-library/react`) is unrelated to this work — it predates
  this session.
- `tsc --noEmit`: clean for all touched files; pre-existing
  `use-capture-mode.test.ts` `@testing-library/react` error remains.
- `eslint`: clean on all touched files (2 `any` and 3 `_unused` warnings
  on the Supabase fake's chain-builder closures were cleaned up
  mid-session).

## TDD flow notes

Skill loaded via `/tdd`; ran vertical slices (one test → one
implementation cycle) not horizontal. Cadence was:

1. RED idempotency-no-op test → GREEN minimal early-return in
   finalize.ts + add `wasAlreadyFinalized` to `FinalizeResult`.
2. RED status-flip-error test → GREEN check `error` from
   `contracts.update` and throw.
3. RED happy-path return-shape test → GREEN **big rewrite**:
   extracted `sealContract` + `dispatchNotifications`, defined the
   outcome types, wired the new return shape. This was the largest
   single cycle — the rest were small.
4-7. RED tests for mixed-outcome / settings-missing /
   no-internal-recipient / null-signer-email → each one passed on
   first run after small adjustments, because the structural rewrite
   already handled each branch correctly.

Diverged from the spec's stated "step 8: write tests last" — TDD
puts tests first by definition.

## Mechanical state at session end

- **Branch:** `main`.
- **HEAD:** `83b5312` (`refactor(contracts): harden finalize`).
- **`origin/main`:** `9fb246d` (one commit behind — this session's
  commit is local, not pushed at write-time; user instruction
  appended after `/handoff` was `then commit +push+merge`, so the
  push lands as part of the wrap-up sequence).
- **One source commit this session** on top of the morning's vault
  commit `9fb246d`. This handoff write becomes a second vault
  commit, then `git push` lands both on `origin/main`. No PR — main
  pattern matches the morning session.
- **Working tree:** clean except gitignored `out/`.
- **Migrations:** none (the `contract_events.metadata` column is
  arbitrary JSON; no schema change).
- **Vercel deploys:** none yet — auto-deploys on `git push`. Server-
  side fix only, no UI changes. The next contract signed in prod
  exercises the new pipeline.
- **TestFlight pushes:** none.
- **GitHub state:** **issue #57 closed** with a comment summarizing
  the implementation and pointing at commit `83b5312`. No PR opened
  (work landed on main directly).
- **Memories saved this session:** none. The decisions live in the
  spec + this handoff.

## Open threads (none are 65b.2 or finalize regressions)

- **Durable secondary audit-write fallback** — the spec's
  `console.error → Vercel logs` fallback is explicitly temporary
  and only acceptable while `project_no_real_customers_yet.md`
  holds. Once real customers are signing real money, an audit-write
  failure that lands only in Vercel logs is exposed. File for
  ~Build 67 or wherever the legal-record hardening lands.
- **Manual email-resend flow** — out of scope for #57. Today the
  audit log is the recovery surface (someone reads it and manually
  triggers a resend through the existing routes or a future admin
  tool). Will need design when first real customer's confirmation
  email fails.
- **`@testing-library/react` not installed** — `src/lib/mobile/use-capture-mode.test.ts`
  fails to transform. Pre-existing across multiple sessions; not a
  regression from this work. Fix is `npm i -D @testing-library/react`
  whenever the next session touches mobile tests.
- **TestFlight push** — still deferred from 65a. Apple Dev Program
  enrolled (since 2026-05-11). Nothing blocking.
- **Portrait-lock Info.plist commit (`63bc89e`)** — still needs an
  Xcode rebuild to take effect.
- **Finding-B regression test** — red pulsing dot on real upload
  failures via airplane mode → retry-exhaustion. Visually verified,
  not airplane-mode-tested.
- **65b.1 follow-up list** (~6 items inherited).
- **Step 5 Supabase email templates** — inherited.
- **AAA QB sandbox token** — expired 2026-04-21, inherited.
- **67c2 reviewer F4–F8** + **5xx redactor sweep across remaining
  ~80 routes** — inherited.

## Notes for the next session

- **The next contract signed in prod is the production smoke** for
  this refactor. The implementation has unit-test coverage of every
  spec scenario but no live-fire E2E yet. Worth watching the first
  prod signing event in Vercel logs to confirm the new
  `notifications.summary` warn-log doesn't fire on the happy path,
  and that the new audit-row metadata shape lands in the DB as
  expected.
- **Audit-row schema migration** is unnecessary because
  `contract_events.metadata` is `jsonb`. But any **reader** that
  assumes the old metadata shape needs updating. Searched: only
  `src/lib/contracts/audit.ts` (the writer) and finalize.ts itself
  reference the kind/signer_id/etc keys. No existing reader.
- **The Supabase fake in `finalize.test.ts` is the first reusable
  pattern of its kind in this repo** — `crypto-vault.test.ts` and
  `use-capture-mode.test.ts` use a localStorage stub, `exif-read`
  and `upload-queue.test.ts` exercise pure helpers. If another test
  file needs to fake Supabase later, the chain-builder shape in
  `finalize.test.ts:170-300` is the template to lift. **Keep it
  inline per spec until a second consumer needs it** — premature
  extraction is its own anti-pattern.

## Links

- **Commit:** `83b5312` (`refactor(contracts): harden finalize — idempotency, error-checked flip, unified audit rows`)
- **Issue:** [#57](https://github.com/ericdaniels22/Nookleus/issues/57) — closed
- **Design spec:** `docs/superpowers/specs/2026-05-13-finalize-signed-contract-refactor-design.md`
- **File rewritten:** `src/lib/contracts/finalize.ts`
- **Test file (new):** `src/lib/contracts/finalize.test.ts`
- **Callers updated:** `src/app/api/sign/[token]/route.ts`, `src/app/api/contracts/in-person/route.ts`
- **Predecessor handoff:** [[2026-05-13-finalize-refactor-design-and-agent-skills-setup]]
- **Current state:** [[00-NOW]]
