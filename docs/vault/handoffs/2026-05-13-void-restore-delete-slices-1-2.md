---
date: 2026-05-13
build_id: standalone (no build card — per #58 PRD pattern)
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-13-void-restore-delete-prd]]", "[[2026-05-13-finalize-refactor-implementation]]"]
---

# Void / restore / delete — slices 1+2 implementation — 2026-05-13 (late evening)

## What this session was

Fourth session of 2026-05-13, after the morning (finalize design +
agent skills), the afternoon (finalize implementation via `/tdd`), and
the evening (void/restore/delete PRD via `/grill-me` → `/to-prd`,
landing issue #58 `ready-for-agent`).

Two artifacts landed in source:

1. **`/to-issues` decomposed #58 into five vertical slices** — issues
   [#59](https://github.com/ericdaniels22/Nookleus/issues/59),
   [#60](https://github.com/ericdaniels22/Nookleus/issues/60),
   [#61](https://github.com/ericdaniels22/Nookleus/issues/61),
   [#62](https://github.com/ericdaniels22/Nookleus/issues/62),
   [#63](https://github.com/ericdaniels22/Nookleus/issues/63), all
   with `ready-for-agent`. Dependency graph: #59 and #60 have no
   blockers; #61 is blocked by #59; #62 is blocked by #59+#60; #63 is
   blocked by #60+#61+#62.
2. **`/tdd` implemented slices #59 and #60**, landing as a single
   source commit `6562143 contracts: fix menu click, write void
   watermark to sidecar PDF (#59, #60)` on `main` (ahead of
   `origin/main` by 1). Both issues closed with commit-pointer
   comments.

Slices #61, #62, #63 are explicitly **deferred to the next session** —
not blocked, just out of scope for this one.

## What got built

### Slice 1 (#59) — Menu mousedown bug fix

`src/components/contracts/contracts-section.tsx:69-75` — the doc-level
listener that closes the `…` menu was changed from `mousedown` to
`click`. Single-character semantic flip:

```diff
-    if (menuId) document.addEventListener("mousedown", onDoc);
-    return () => document.removeEventListener("mousedown", onDoc);
+    if (menuId) document.addEventListener("click", onDoc);
+    return () => document.removeEventListener("click", onDoc);
```

The menu panel at line 420 already has `onClick={(e) =>
e.stopPropagation()}`, so clicks inside the menu now reach their
buttons. Clicks outside still bubble to the doc-listener and close the
menu. Discard draft / Void contract fire correctly in production
again.

Regression test:
`src/components/contracts/contracts-section.test.tsx` — mounts
`ContractsSection`, mocks fetch, opens the menu on a draft row,
dispatches `fireEvent.mouseDown(discardBtn)` followed by
`fireEvent.click(discardBtn)` (the same sequence
`@testing-library/user-event` would produce), and asserts that the
`/api/contracts/c-1/void` POST was issued. The test was written RED
first against the buggy code and turned GREEN with the listener swap.

### Slice 2 (#60) — Void writes watermark to sidecar PDF

`src/app/api/contracts/[id]/void/route.ts` was refactored so that
voiding a signed contract no longer overwrites the canonical signed
PDF. The "VOIDED" watermark is written to
`${signed_pdf_path}.voided.pdf` instead; restoring a signed contract
in the next slice (#62) will now be a pure status flip with no PDF
work.

Two deep modules extracted from the old inline implementation:

- **`src/lib/contracts/pdf-void-sidecar.ts`** —
  `writeVoidWatermarkSidecar(supabase, canonicalPath): Promise<{
  sidecarPath }>` plus its companion `computeVoidSidecarPath(path)`.
  Wraps download → stamp → upload-to-sidecar. Imports
  `stampVoidWatermark` from the pre-existing `pdf-void-watermark.ts`
  (which keeps the actual pdf-lib stamping logic untouched).
- **`src/lib/contracts/payment-block.ts`** —
  `assertJobHasNoPayments(supabase, jobId): Promise<void>` plus
  `JobHasPaymentsError`. The exact rule that lived inlined at
  `void/route.ts:46-66` before. Routes catch `JobHasPaymentsError` and
  return HTTP 409 with the canonical "refund or void payments first"
  message. **Ready for re-use by the permanent-delete route in #63**.

### Helpers' test pattern

Each helper has its own in-file Supabase fake scoped to exactly the
calls it issues:

- `pdf-void-sidecar.test.ts` — mocks `./pdf-void-watermark` at module
  level so the test can pass dummy bytes through; fake tracks every
  download + upload with bucket/path/bytes/options; asserts the
  canonical key is **never** in the upload list.
- `payment-block.test.ts` — fake supports `from('invoices').select.eq`
  and `from('payments').select(_, { count: 'exact', head: true }).in`;
  the test wraps `.from` to assert the payments query is **not** run
  when the job has no invoices (cheaper short-circuit).
- `void/route.test.ts` — mocks `@/lib/supabase-server` +
  `@/lib/supabase-api` at module level; an `auth` helper returns
  `{ user: null }` for the 401 case; integration scenarios cover 401,
  404, 409-already-voided, 409-job-has-payments, draft-doesn't-touch-
  storage, sent-doesn't-touch-storage, signed-uploads-to-sidecar-not-
  canonical, and the upload-error 500 path.

## TDD cycles run

Each cycle was a strict RED → GREEN → next-test loop. Refactor steps
were folded into the GREEN of the next cycle when warranted, never
while RED.

1. **Cycle A** — `src/components/contracts/contracts-section.test.tsx`
   asserts the mousedown + click sequence reaches the Discard handler.
   RED (fetch never called with `/void`) → GREEN (listener swap).
2. **Cycle B** — `pdf-void-sidecar.test.ts` asserts download from
   canonical key, upload to sidecar key, canonical untouched. RED
   (module doesn't exist) → GREEN (new file). Two follow-on tests in
   the same file cover the download-error and upload-error throw
   paths.
3. **Cycle C** — `payment-block.test.ts` asserts the throw on
   payments-exist + the short-circuit on no-invoices. RED → GREEN
   (new file).
4. **Cycle D** — `void/route.test.ts` asserts the signed-to-sidecar
   path. RED (current code uploads to canonical) → GREEN (route
   refactored to call both helpers, watermark to sidecar key).
   Surrounding scenarios for 401/404/409/draft/sent/upload-error
   landed pre-refactor as guards.

## Test infrastructure side-effect

`@testing-library/react@^16.3.2` was declared in `package.json` but
was **not actually installed** in `node_modules` — likely a stale
lockfile from a prior session. `npm install` pulled it in along with
9 sibling packages with no further changes to `package-lock.json`'s
top-level entries.

`vitest.config.ts` gained a `resolve.alias` mapping:

```ts
resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
```

The morning's `finalize.test.ts` sidestepped this by using relative
imports throughout, but the component test in slice 1 needs to import
the real `ContractsSection`, which uses `@/lib/contracts/...` paths.
Adding the alias was the smallest change that unblocked it.

These two changes together also fix the pre-existing
`src/lib/mobile/use-capture-mode.test.ts` import failure noted in the
morning + afternoon handoffs.

## Mechanical state at session end

- **Branch:** `main`.
- **HEAD at session start:** `3d8c41d` (the evening PRD vault commit).
- **HEAD after slice 1+2 commit:** `6562143`.
- **HEAD at handoff write-time:** still `6562143` — this handoff write
  will become a vault commit on top, then push.
- **`origin/main`:** `3d8c41d` (in sync at session start; **1 commit
  behind after this session**, will be 2 behind after the vault
  commit).
- **Working tree:** clean except gitignored `out/`.
- **Tests:** 47 passing across 9 files (was 30 / 5 before — 17 new
  tests across 4 new test files: `contracts-section.test.tsx`,
  `pdf-void-sidecar.test.ts`, `payment-block.test.ts`,
  `void/route.test.ts`).
- **Lint:** clean across touched files.
- **Migrations applied:** none — slices 1+2 are code-only.
- **Vercel deploys:** none until push.
- **TestFlight pushes:** none.
- **GitHub state:** **issues #59 and #60 closed** with commit-pointer
  comments referencing `6562143`. **Issues #61, #62, #63 published**
  this session with `ready-for-agent` (created during the `/to-issues`
  pass earlier in the session). **#58 remains open** as the umbrella.
- **Memories saved this session:** none — the testing-library install
  + vitest alias are mechanical fixups already encoded in
  `package-lock.json` and `vitest.config.ts`; they don't need a memory
  record.

## Slices remaining for the next session

The three deferred slices are independently grabbable in either
sequential or partially-parallel order:

- **#61 (Delete draft, one-click hard-delete)** — unblocked now (#59
  closed). Introduces the first new RPC of the feature
  (`delete_contract`), a new `DELETE /api/contracts/[id]` route
  (draft branch only), and the "Delete draft" menu-item rename. The
  RPC will need a migration; mirror the build-59
  `migration-build59-contract-event-rpcs-organization-id.sql` style.
- **#62 (Restore voided contract)** — unblocked now (#59+#60 closed).
  Introduces the `restore_contract` RPC, the `computeRestoreTargetStatus`
  pure function, and the `'restored'` variant on `ContractEventType`.
  Needs a migration to (a) ALTER the `contract_events.event_type`
  CHECK constraint at `migration-build33-contracts.sql:80-83` to add
  `'restored'` and (b) `CREATE OR REPLACE FUNCTION restore_contract`.
  Removes the `{!isVoided && ...}` gate at
  `contracts-section.tsx:404`.
- **#63 (Permanently delete voided contract)** — blocked by #60 (✓
  done), #61 (DELETE route + `delete_contract` RPC), #62 (voided-row
  menu). Extends the DELETE route with the voided branch, re-uses
  `assertJobHasNoPayments` + `JobHasPaymentsError`, and cleans up
  both canonical + sidecar storage keys. Adds the
  `PermanentlyDeleteDialog` component.

The natural order is #61 → #62 → #63. Each is independently
committable; the PRD called for a single commit but the slicing now
makes per-slice commits the cleaner pattern.

## Open threads

Most are inherited from the morning + afternoon + evening sessions.
Two new items from this session:

- **Push `6562143` to `origin/main`** — the slice 1+2 commit is local
  only. Vercel deploy will fire on push, no behavior change beyond
  the slice scope. (Plus this handoff commit, which will also push.)
- **`/tdd` Supabase-fake pattern extraction candidate** — the
  in-file fake in `void/route.test.ts` is the **second** consumer of
  the chain-builder pattern (the first being `finalize.test.ts`).
  The slices ahead (#61, #62, #63) will add three more consumers.
  Per the rule confirmed this morning, **don't extract yet** —
  premature extraction has been the wrong call until a third+
  consumer exists. The `/tdd` skill's guidance applies: extract
  when the third consumer can demonstrate the shared shape.

Inherited (unchanged from prior handoffs):

- **Durable secondary audit-write fallback** — `console.error` to
  Vercel logs is explicitly temporary, filed for ~Build 67.
- **Manual email-resend flow** — out of scope.
- **TestFlight push** — Apple Dev Program enrolled 2026-05-11; still
  deferred.
- **Portrait-lock Info.plist commit (`63bc89e`)** — still needs an
  Xcode rebuild.
- **Finding-B regression test** — visually verified, not
  airplane-mode-tested.
- **65b.1 follow-up list** (~6 items).
- **Step 5 Supabase email templates**.
- **AAA QB sandbox token** — expired 2026-04-21.
- **67c2 reviewer F4–F8** + **5xx redactor sweep across remaining
  ~80 routes**.

## Notes for the next session

- **Start by opening #61, #62, #63** and pick up directly. The PRD
  body on #58 has all the design decisions; you don't need to
  re-`/grill-me`.
- **The migration for #62 is the most subtle one** — the
  `contract_events.event_type` CHECK constraint must accept
  `'restored'` before the new RPC can insert that event variant.
  Either drop+re-add the constraint or replace it via
  `ALTER TABLE ... DROP CONSTRAINT + ADD CONSTRAINT`. Mirror the
  pattern used in build 59 for the void route's `organization_id`
  columns.
- **The route-test pattern is now established** — `void/route.test.ts`
  is the template for #61, #62, #63 route tests. Lift the `from` +
  `storage` + `rpc` fake builder as-is; only the seeded rows + RPC
  expectations change per slice.
- **Don't re-extract the chain-builder yet.** It's the same rule the
  morning/afternoon honored — wait for the third consumer (probably
  the #61 DELETE route test) to land, then consider lifting.
- **`computeRestoreTargetStatus` is the perfect first cycle of #62**
  — pure function, four-branch derivation. Unit tests are trivial;
  it sets up the rest of the slice cleanly.
- **Drafts have no PDF, no payment-block check, no sidecar** —
  slice #61 is the simplest of the remaining three. If you want to
  ship one more slice before another handoff, that's the target.

## Links

- **Parent issue:** [#58](https://github.com/ericdaniels22/Nookleus/issues/58) — open, umbrella.
- **Slice issues**:
  - [#59](https://github.com/ericdaniels22/Nookleus/issues/59) — **closed in `6562143`**.
  - [#60](https://github.com/ericdaniels22/Nookleus/issues/60) — **closed in `6562143`**.
  - [#61](https://github.com/ericdaniels22/Nookleus/issues/61) — open, `ready-for-agent`.
  - [#62](https://github.com/ericdaniels22/Nookleus/issues/62) — open, `ready-for-agent`.
  - [#63](https://github.com/ericdaniels22/Nookleus/issues/63) — open, `ready-for-agent`.
- **Source commit:** `6562143` — `contracts: fix menu click, write void watermark to sidecar PDF (#59, #60)`.
- **Predecessor handoff:** [[2026-05-13-void-restore-delete-prd]].
- **Current state:** [[00-NOW]].
- **Test pattern reference:** `src/lib/contracts/finalize.test.ts` (the chain-builder template; still the only fully-built example until the third consumer extracts it).
- **Helpers introduced this session:**
  - `src/lib/contracts/pdf-void-sidecar.ts`
  - `src/lib/contracts/payment-block.ts`
- **Route refactored:** `src/app/api/contracts/[id]/void/route.ts`.
