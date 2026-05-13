---
date: 2026-05-13
build_id: standalone (no build card — per #58 PRD pattern)
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-13-void-restore-delete-prd]]", "[[2026-05-13-void-restore-delete-slices-1-2]]", "[[2026-05-13-void-restore-delete-slice-3]]", "[[2026-05-13-void-restore-delete-slice-4]]"]
---

# Void / restore / delete — slice 5 (#63 Permanently delete voided) implementation — 2026-05-13

## What this session was

Seventh session of 2026-05-13, after the morning (finalize design + agent
skills), the afternoon (finalize implementation via `/tdd`), the evening
(void/restore/delete PRD via `/grill-me` → `/to-prd`, landing issue #58),
the late evening (`/to-issues` decomposing #58 into five slices, then
`/tdd` shipping slices 1+2 / #59+#60), the late-evening continuation
(slice 3 / #61 Delete draft), and the sixth-session (slice 4 / #62
Restore voided).

This session ran slice 5 — issue
[#63](https://github.com/ericdaniels22/Nookleus/issues/63) "Permanently
delete voided contract" — via `/tdd` with strict RED→GREEN per cycle,
opening with the long-deferred `ConfirmDialog` extraction (the
third-consumer moment that slice 3 + 4's handoffs both flagged).

Two artifacts landed:

1. **Source commit `b59b602`** on `main`, pushed to `origin/main` —
   bundles the helper extension, the route's voided branch, the UI
   menu item + dialog, the `ConfirmDialog` extraction, and all tests.
2. **No migration** — `delete_contract` RPC reused as-is from slice #61
   (the storage cleanup happens at the route layer, not the RPC layer).

Slice #63 was the last open slice; **umbrella #58 closed** in this
session.

## What got built

### Helper — `makeSupabaseFake()` gains `storage.from(b).remove(paths)`

`src/lib/contracts/__test-utils__/supabase-fake.ts` extended:

- `state.storageRemovals: { bucket: string; paths: string[] }[]` —
  tracker mirrors `storageUploads` / `storageDownloads`.
- `storage.from(bucket).remove(paths)` async method — pushes to the
  tracker, honors `setError("storage.${bucket}.remove")` for failure
  injection, deletes matching `state.storageBlobs[]` entries on success,
  returns the supabase-js shape `{ data: paths.map(name => ({ name })), error: null }`.

This was the only helper expansion needed; no other shape changed. The
extension was a single-cycle no-RED setup move (helper alone doesn't fail
any test) before the route work started. Full suite stayed green at
**72/12** after the extension and before the first new route test
(slice-3 marker: in-file fake was lifted to this helper file; this
session adds the `remove` surface that slice-3's handoff predicted).

### Route — `DELETE /api/contracts/[id]` voided branch

`src/app/api/contracts/[id]/route.ts` extended. Flow now:

```
auth (createServerSupabaseClient)
  → 401 if unauthed
load contract via service-role client
  → 404 if missing
status guard
  → 409 unless status === 'draft' || status === 'voided'
       (sent/viewed/signed/expired must be voided first)

IF status === 'voided':
  assertJobHasNoPayments(supabase, contract.job_id)
    → 409 if JobHasPaymentsError (refund or void payments first)
  IF contract.signed_pdf_path:
    storage.from('contracts').remove([canonical, sidecar])
      where sidecar = computeVoidSidecarPath(canonical)
      → 500 if rmErr (RPC is NOT called; DB unchanged)

rpc('delete_contract', { p_contract_id: id })
  → 500 if rpcErr (voided branch: storage already gone → orphan blob,
                    DB row survives for retry)
  → 200 { ok: true } on success
```

**Two design decisions worth flagging:**

1. **Storage-first order.** Symmetric with slice #60's void route
   (sidecar upload happens before the RPC). If storage fails, the
   contract row is untouched and the user can retry. If the RPC fails
   after storage succeeded, the DB row survives but the blob is orphaned
   — acceptable because permanent-delete is the terminal state, and a
   stray blob is a small cost. The alternative (RPC-first) would mean a
   failed storage cleanup leaves the DB row gone but the file lingers
   forever with no audit anchor.
2. **Sidecar path reused from `pdf-void-sidecar.ts`.** Imported
   `computeVoidSidecarPath` rather than reconstructing the
   `${canonical}.voided.pdf` pattern at the route layer. Single source
   of truth.

**The `it.each` 409 list narrowed.** Previously asserted
`sent/viewed/signed/expired/voided` all return 409; now only
`sent/viewed/signed/expired` (voided becomes a 200). This was a
preparation cycle (no RED — narrowing an assertion that still passes
under current behavior, before adding the positive voided-success test).

### UI — Voided menu gains "Permanently delete"; `ConfirmDialog` extracted

`src/components/contracts/contracts-section.tsx`:

- `AlertTriangle` lucide icon imported (used for the perm-delete
  modal headline).
- `permDeleteTarget` state added, mirroring `deleteDraftTarget`.
- `handlePermanentlyDelete(id)` — DELETE `/api/contracts/[id]`, success
  toast "Contract permanently deleted", 401 handling, 6-second error
  toast duration, mirrors `handleDeleteDraft` exactly.
- `RowProps` extended with `onPermanentlyDelete`.
- Voided menu branch now renders **both** items (a fragment):
  - `Restore` — unchanged from #62.
  - `Permanently delete` — new, opens the ConfirmDialog.

**`src/components/contracts/confirm-dialog.tsx` is brand-new.** Generic
destructive-confirm modal: `{ open, ariaLabel, title, body, onCancel,
onConfirm, confirmLabel?, cancelLabel? }`. Body and title are
`ReactNode` so callers can interpolate contract titles + icons inline.
Cancel + backdrop click both fire `onCancel`. Confirm button is the
red-destructive variant (`bg-red-500/90 text-white`).

**Both inline dialogs migrated:**

- `DeleteDraftDialog` (slice #61) — body text "This draft was never
  sent…"; no icon.
- `PermanentlyDeleteDialog` (this slice) — title has the
  `<AlertTriangle />` icon; body interpolates the contract title in
  bold and warns "This can't be undone."

**`VoidContractDialog` deliberately NOT migrated.** It carries a reason
textarea + uses the shadcn `Dialog` primitive (not a custom backdrop
div) + has its own busy spinner state during the request. Lifting a
union helper across confirm-only and form-bearing dialogs would have
over-fit the abstraction. The session-start plan flagged this and Eric
confirmed scope ("Just DeleteDraft + PermanentlyDelete (Recommended)").

This **diverges from slice-3 and slice-4 handoffs' wording**, both of
which said "extract ConfirmDialog alongside DeleteDraftDialog and
VoidContractDialog (three consumers)." On inspection at extraction time
VoidContractDialog's shape was too different — the two-way extract is
the right pick. Memory candidate: the prior handoffs' framing relied on
a quick scan; YAGNI plus actual code shape beats the predicted plan
when they conflict.

### Migration — none

`delete_contract` RPC ships intact from slice #61. The new voided branch
adds storage cleanup at the route layer, not at the RPC. No
`contract_events.event_type` change either — permanent-delete records
no event (the row + its events cascade to nothing). Result: this is the
first slice in the #58 family that ships with **zero migrations**.

## Helpers' test pattern

The new `storage.from(b).remove(paths)` surface is the **fourth feature
added to `makeSupabaseFake()`** (after the initial extract in slice 4 +
`selectFromCalls` from slice 3 + the `eq`/`in`/`maybeSingle`/thenable +
storage download/upload from the original lift). The growth pattern is
working: one new method per slice that needs it; no premature features.

Route tests in `route.test.ts` are now the **fourth consumer of the
shared fake** (alongside `[id]/route.test.ts`, `void/route.test.ts`,
and `restore/route.test.ts`). All four reach for the same
`makeSupabaseFake()` + `makeAuthedFake()` + `makeUnauthedFake()` triple.

## TDD cycles run

Strict RED → GREEN per cycle. Each test was written first against the
unwritten or partial implementation and turned GREEN with minimal code.

1. **Cycle 0 — helper extension (no RED).** Added `storage.remove` +
   `storageRemovals` tracker. Suite stayed at 72/12. Per the TDD skill
   rule "Never refactor while RED. Get to GREEN first." — we started
   green, so this is fine.
2. **Cycle 1 — `it.each` list narrowed (no RED).** Dropped `voided`
   from the 409 list before adding positive voided-success tests.
   Existing assertions still passed under the old route (which still
   returned 409 for voided); narrowing was a setup move.
3. **Cycle 2 — voided + signed PDF + no payments → 200 (RED).**
   Asserted (a) 200, (b) `selectFromCalls.includes('invoices')` positive
   payment-block-ran, (c) `storageRemovals === [{ bucket: 'contracts',
   paths: [canonical, sidecar] }]`, (d) single `delete_contract` RPC
   call. RED: 409. GREEN: added voided branch with payment-block +
   storage.remove + RPC.
4. **Cycle 3 — voided + has payments → 409 (already GREEN).** Seeded
   invoice + payment on the job. After cycle 2's GREEN code, this test
   passed on first run — the payment-block was wired together with the
   voided branch. Still committed for explicit AC coverage.
5. **Cycle 4 — voided + null `signed_pdf_path` → 200, no storage
   (already GREEN).** Cycle 2's GREEN code guarded the storage call
   with `if (contract.signed_pdf_path)`, so this test passed on first
   run. Still committed for the voided-before-signing case.
6. **Cycle 5 — storage.remove error → 500, no RPC (RED implicitly).**
   `setError("storage.contracts.remove")` — asserts 500 and
   `rpcCalls.length === 0` (storage-first order is observable). After
   cycle 2's GREEN code, this passed on first run.
7. **Cycle 6 — voided + RPC error after storage success → 500.**
   `setError("rpc.delete_contract")` on a voided row with sidecar.
   Asserts 500 + `storageRemovals.length === 1` (positive: storage was
   already gone). Passed on first run after cycle 2.
8. **Cycle 7+8 — UI bundled (RED).** Single test file extension with
   three new tests: (a) voided row shows both `Restore` + `Permanently
   delete`, clicking the latter opens a confirm dialog, no DELETE
   fired; (b) confirming → DELETE `/api/contracts/c-1`; (c) cancelling
   → no DELETE. RED: "Permanently delete" not in menu. GREEN: added
   the menu item + `PermanentlyDeleteDialog` (initially inline) +
   `handlePermanentlyDelete` + `permDeleteTarget` state +
   `onPermanentlyDelete` row prop.
9. **Refactor (post-GREEN) — `ConfirmDialog` extracted.** Created
   `confirm-dialog.tsx` with the generic shape. Migrated
   `DeleteDraftDialog` and the new `PermanentlyDeleteDialog` to use it
   from `contracts-section.tsx`. The inline component definitions were
   deleted. Full suite (12 files, 79 tests) stayed green through the
   refactor.

## Mechanical state at session end

- **Branch:** `main`.
- **HEAD at session start:** `cdda7bc` (the slice-4 vault commit; in
  sync with `origin/main`).
- **HEAD at session end:** `b59b602` (one source commit landed +
  pushed). Vault commit on top after this handoff.
- **`origin/main`:** `b59b602` — in sync.
- **Working tree at handoff write-time:**
  - Modified: `src/app/api/contracts/[id]/route.test.ts` (it.each
    narrowed + 5 new tests for voided branch),
    `src/app/api/contracts/[id]/route.ts` (voided branch added),
    `src/components/contracts/contracts-section.test.tsx` (3 new
    perm-delete tests),
    `src/components/contracts/contracts-section.tsx` (menu item +
    handler + both dialogs migrated to `ConfirmDialog`),
    `src/lib/contracts/__test-utils__/supabase-fake.ts` (storage.remove).
  - Untracked: `src/components/contracts/confirm-dialog.tsx`
    (extracted), plus gitignored `out/`.
  - Net: **6 files, 436 insertions(+), 70 deletions(-)** (the deletion
    side is the two inline dialogs being replaced by `ConfirmDialog`
    calls).
- **Tests:** **79 passing across 12 files** (was 72/12 at session start
  — **+7 tests across 1 expanded route test file + 1 expanded UI test
  file**).
  - Route +5: voided-success-with-storage, voided-with-payments-409,
    voided-with-null-PDF-200, storage-remove-err-500, voided-RPC-err-500.
  - UI +3: voided-shows-both-items + confirm-fires-DELETE +
    cancel-suppresses-DELETE.
- **Lint:** clean across touched files.
- **Typecheck:** `tsc --noEmit` clean across the repo.
- **Migrations applied:** **none** — `delete_contract` RPC ships intact
  from slice #61.
- **Vercel deploys:** **success** on `b59b602`
  ([deploy](https://vercel.com/nookleus/nookleus/Af2rQEMBdhfC9fXA2e6ocWeXqSd5)).
- **TestFlight pushes:** none. Xcode Cloud iOS archive showed as
  `pending` on the commit at end-of-session — unrelated, separate
  pipeline (TestFlight push is still deferred per long-standing open
  thread).
- **GitHub state:**
  - **Issue #63 closed** by `b59b602` trailer (`Closes #63 and umbrella
    #58.`).
  - **Issue #58 (umbrella) closed** manually with a slice roll-up
    comment listing all five commits: `6562143` (#59+#60), `b297ed9`
    (#61), `6a3afc9` (#62), `b59b602` (#63).
  - All five slice issues + the umbrella are now CLOSED. No remaining
    `ready-for-agent` issues under #58.
- **Memories saved this session:** 0.

## Slice family — final state

Every slice of #58 is shipped. Roll-up:

| Slice | Issue | Commit | What |
|-------|-------|--------|------|
| 1 | #59 | `6562143` | Fix `mousedown` → `click` doc-listener on `…` menu |
| 2 | #60 | `6562143` | Void watermark to sidecar; `assertJobHasNoPayments` extract |
| 3 | #61 | `b297ed9` | `DELETE /api/contracts/[id]` draft branch + `delete_contract` RPC |
| 4 | #62 | `6a3afc9` | `POST /api/contracts/[id]/restore` + `restore_contract` RPC + `'restored'` event type |
| 5 | #63 | `b59b602` | `DELETE /api/contracts/[id]` voided branch + storage cleanup + `ConfirmDialog` extract |

Two migrations applied to AAA prod during the family:

- `migration-build68a-contract-delete-rpc.sql` (slice 3).
- `migration-build68b-contract-restore-rpc-and-event-type.sql` (slice 4).

## Open threads

Inherited from prior sessions, unchanged:

- **Durable secondary audit-write fallback** — `console.error` to
  Vercel logs is explicitly temporary, filed for ~Build 67.
- **Manual email-resend flow** — out of scope.
- **TestFlight push** — Apple Dev Program enrolled 2026-05-11; still
  deferred. The Xcode Cloud iOS archive that fired on `b59b602` is the
  routine post-push build, not the TestFlight publish — different lever.
- **Portrait-lock Info.plist commit (`63bc89e`)** — still needs an
  Xcode rebuild.
- **Finding-B regression test** — visually verified, not
  airplane-mode-tested.
- **65b.1 follow-up list** (~6 items).
- **Step 5 Supabase email templates**.
- **AAA QB sandbox token** — expired 2026-04-21.
- **67c2 reviewer F4–F8** + **5xx redactor sweep across remaining
  ~80 routes**.

Inherited from slice 4, now resolved:

- ~~`makeSupabaseFake()` will need `storage.from(b).remove([])` for
  slice #63~~ — done this session.

Inherited from slice 3 + 4, partially diverged:

- ~~Third confirm-dialog consumer extracts a shared `ConfirmDialog`
  across `DeleteDraftDialog` + `VoidContractDialog` +
  `PermanentlyDeleteDialog`~~ — extracted for the two binary-confirm
  consumers (DeleteDraft + PermanentlyDelete) only. `VoidContractDialog`
  stays separate (reason-textarea + Dialog primitive). See "UI" section
  above for rationale.

New this session (worth carrying):

- **First-prod smoke** for the permanent-delete path: when a voided
  contract is ever permanently deleted in prod, watch Vercel logs for
  the `delete_contract` RPC call and confirm the contracts-bucket
  removal lands cleanly. Low priority — no real customers yet
  (`project_no_real_customers_yet.md`).

## Notes for the next session

#58 is closed and there's no obvious natural next thing inside this
feature family. Candidate directions from the open-threads list:

- **Build 67 durable audit-write fallback** — promote the
  `console.error` fallback in `finalizeSignedContract` to a real
  secondary surface (separate table or structured-logging pipeline)
  before real customers arrive.
- **5xx redactor sweep across remaining ~80 routes** — touches every
  route handler; could be `/triage`d to a tracer-bullet plan.
- **TestFlight push** — Apple Dev Program enrolled 2026-05-11; the
  blocker has been gone for two days.

Each of these is a fresh-session candidate. None is a regression risk
from this slice family.

## Links

- **Parent issue:** [#58](https://github.com/ericdaniels22/Nookleus/issues/58) — **CLOSED** in this session.
- **Slice issues**:
  - [#59](https://github.com/ericdaniels22/Nookleus/issues/59) — **closed in `6562143`**.
  - [#60](https://github.com/ericdaniels22/Nookleus/issues/60) — **closed in `6562143`**.
  - [#61](https://github.com/ericdaniels22/Nookleus/issues/61) — **closed in `b297ed9`**.
  - [#62](https://github.com/ericdaniels22/Nookleus/issues/62) — **closed in `6a3afc9`**.
  - [#63](https://github.com/ericdaniels22/Nookleus/issues/63) — **closed in `b59b602`** (this session).
- **Source commit:** `b59b602` — pushed to `origin/main`; Vercel
  deploy: success.
- **Vercel deploy:** https://vercel.com/nookleus/nookleus/Af2rQEMBdhfC9fXA2e6ocWeXqSd5
- **Predecessor handoff:** [[2026-05-13-void-restore-delete-slice-4]].
- **Current state:** [[00-NOW]].
- **Files added this session:**
  - `src/components/contracts/confirm-dialog.tsx`
- **Files modified this session:**
  - `src/app/api/contracts/[id]/route.ts` (voided branch)
  - `src/app/api/contracts/[id]/route.test.ts` (it.each narrowed + 5 new tests)
  - `src/components/contracts/contracts-section.tsx` (menu item + handler + both dialogs migrated to `ConfirmDialog`)
  - `src/components/contracts/contracts-section.test.tsx` (3 new perm-delete tests)
  - `src/lib/contracts/__test-utils__/supabase-fake.ts` (`storage.remove` + `storageRemovals` tracker)

## Post-handoff hotfix — commit `afbfa2a`

Right after this handoff was written, Eric hit a prod 500 voiding a
signed contract (`f872b080-155a-49d8-bea5-ea2f07d2a824`) whose canonical
PDF was missing from the `contracts` bucket. Slice #60's
`writeVoidWatermarkSidecar` was hard-failing the storage download with
"Object not found" and bubbling that to the route as a 500.

The sidecar exists only to mark the canonical "voided" — if the canonical
isn't there, the sidecar is moot, and the load-bearing action (status
flip + signing-link kill via the HTTP 410 path) should not be blocked.

**Fix shipped in commit `afbfa2a`** `contracts: tolerate missing canonical PDF when voiding signed contracts`:

- `src/lib/contracts/pdf-void-sidecar.ts` exports a new
  `CanonicalPdfNotFoundError` class. It's thrown specifically when the
  storage download error message matches `/not found/i`. Other download
  errors (rate-limit, perms, etc.) still throw a generic `Error`.
- `src/app/api/contracts/[id]/void/route.ts` catches
  `CanonicalPdfNotFoundError`, `console.warn`s the orphan path
  (`[void] canonical PDF missing for contract ${id} at ${path}; voiding without sidecar`),
  and falls through to the `void_contract` RPC. The status flip happens;
  the signing link dies. Generic errors still 500 as before.
- `src/lib/contracts/pdf-void-sidecar.test.ts` — the old
  "throws when the canonical PDF cannot be downloaded" test was split
  into two: (a) throws specifically `CanonicalPdfNotFoundError` on
  `not found` messages; (b) throws a generic `Error` on other download
  errors (and the rejection is asserted NOT to be a
  `CanonicalPdfNotFoundError` instance).
- `src/app/api/contracts/[id]/void/route.test.ts` — added a
  missing-canonical test: voiding a `signed` contract whose blob is
  not seeded returns 200, attempts the download (positive: we tried),
  uploads nothing, and still fires the `void_contract` RPC.

**Tests at hotfix end**: **81 passing across 12 files** (was 79/12 at
session-end before the hotfix — **+2 tests across 1 expanded sidecar
test file + 1 expanded void route test file**). Typecheck + lint clean.
Vercel deploy on `afbfa2a` succeeded
([deploy](https://vercel.com/nookleus/nookleus/HirWNi797uREvBs3Z1yrUsAYZarv));
Eric re-tried the void in prod and it worked.

**Diagnostic detour worth recording**: the prod query that found this
revealed **5 orphan rows in test org `a0000000-0000-4000-8000-000000000001`**,
all with `status='signed'` + `signed_pdf_path` set + the actual file
missing in the bucket. Path scheme on the orphans is
`<orgId>/contracts/<contractId>-signed.pdf` (3 real-org signed contracts
in other orgs use `<orgId>/<contractId>.pdf` — shorter, no `contracts/`
prefix, no `-signed` suffix). The two-scheme split looks like seed data
inserted via SQL without a real upload, and is not addressed by this
hotfix — the orphans remain in the DB but the void path tolerates them.
A code-side path-scheme audit is queued as an open thread for a future
session.

**New open thread (carried forward from hotfix)**: investigate whether
the test-org orphan rows ever had real PDFs (likely no), and whether
the path-scheme split (`<org>/contracts/<id>-signed.pdf` vs
`<org>/<id>.pdf`) is intentional or an artifact of two upload code
paths. If the latter, consolidate. Low priority — soft-skip in the
void route is the load-bearing protection.

**Mechanical state at hotfix end**: branch `main` HEAD `afbfa2a`, in
sync with `origin/main`; this section was appended after the slice-5
vault commit landed. One more vault commit on top after this edit.
