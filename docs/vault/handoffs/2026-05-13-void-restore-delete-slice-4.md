---
date: 2026-05-13
build_id: standalone (no build card — per #58 PRD pattern)
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-13-void-restore-delete-prd]]", "[[2026-05-13-void-restore-delete-slices-1-2]]", "[[2026-05-13-void-restore-delete-slice-3]]"]
---

# Void / restore / delete — slice 4 (#62 Restore voided) implementation — 2026-05-13

## What this session was

Sixth session of 2026-05-13, after the morning (finalize design + agent
skills), the afternoon (finalize implementation via `/tdd`), the
evening (void/restore/delete PRD via `/grill-me` → `/to-prd`, landing
issue #58), the late evening (`/to-issues` decomposing #58 into five
slices, then `/tdd` shipping slices 1+2 / #59+#60), and the late
evening continuation (slice 3 / #61 Delete draft).

This session ran slice 4 — issue
[#62](https://github.com/ericdaniels22/Nookleus/issues/62) "Restore
voided contract" — via `/tdd` with strict RED→GREEN per cycle, opening
with the long-deferred `makeSupabaseFake()` extraction (the
third-consumer moment honored across the prior five sessions).

Two artifacts will land at commit:

1. **One pending source commit** on `main` (push immediate) bundling
   the helper extraction, the new pure function, the `'restored'` event
   type, the route + tests, the UI changes + tests, and the migration
   SQL file.
2. **Migration `migration-build68b-contract-restore-rpc-and-event-type.sql`**
   already applied to AAA prod (`rzzprgidqbnqcdupmpfe`) via the Supabase
   MCP after explicit plain-text approval from Eric ("yes apply").

Slice #63 remains the last open slice, with `ready-for-agent`.

## What got built

### Helper — `makeSupabaseFake()` extracted to shared `__test-utils__`

`src/lib/contracts/__test-utils__/supabase-fake.ts` is brand-new. Exports
`makeSupabaseFake()` (the chain-builder fake: select `.eq`/`.in`/
`.maybeSingle`/thenable + storage `download`/`upload` + seedBlob + rpc
+ errors + `selectFromCalls` tracker), `makeAuthedFake(userId?)`, and
`makeUnauthedFake()`. Migrated **both** RPC-route tests
(`src/app/api/contracts/[id]/route.test.ts` and
`src/app/api/contracts/[id]/void/route.test.ts`) to import from it,
deleting ~290 lines of duplicate fake setup across the two files.

**`finalize.test.ts` was intentionally NOT migrated** — its fake has a
different shape (direct UPDATE + INSERT + ORDER + LIMIT chain builders
for the library function that writes contracts/contract_events
directly, not RPC), and lifting a union helper for both shapes would
over-fit. Eric confirmed this scope explicitly: "Migrate only the two
RPC-route tests."

The helper deliberately covers the RPC-route shape only — if slice #63
adds storage cleanup of canonical+sidecar PDFs via `storage.remove([])`,
the helper will need a `remove` method added.

### Pure function — `computeRestoreTargetStatus(c)`

`src/lib/contracts/restore-target-status.ts` is brand-new. Takes
`{ signed_at, first_viewed_at, sent_at }` (a narrow `RestoreTargetInputs`
interface so any row shape — full Contract, list-view row, hand-built
fixture — can be passed without ceremony) and returns a `ContractStatus`
via precedence:

```
signed_at !== null              → 'signed'
first_viewed_at !== null        → 'viewed'
sent_at !== null                → 'sent'
otherwise                       → 'draft'
```

Test file `restore-target-status.test.ts` covers all four branches plus
the precedence edge (all three timestamps non-null → 'signed' wins).
**5 tests, each written RED-first.** This was the natural opener after
the helper refactor — pure, trivial unit tests that set up the
restore-target derivation rule before any route or DB work.

### `ContractEventType` — `'restored'` variant added

`src/lib/contracts/types.ts:99` — single-line addition between
`'voided'` and `'expired'`. No other type changes needed; the route
and the migration are the only consumers.

### Route — `POST /api/contracts/[id]/restore`

`src/app/api/contracts/[id]/restore/route.ts` is brand-new. Flow:

```
auth (createServerSupabaseClient)
  → 401 if unauthed
load contract via service-role client
  → 404 if missing
status guard
  → 409 unless status === 'voided' (covers draft/sent/viewed/signed/expired)
rpc('restore_contract', { p_contract_id: id, p_restored_by: user.id })
  → 500 if rpc error
  → 200 { ok: true } on success
```

**No payment-block check.** Restore is the opposite of destruction —
the issue body, the PRD, and the void-route's existing comment all
agree explicitly.

**No storage surface.** Restoring a signed contract relies on slice #60
having already moved the void watermark to a sidecar file
(`canonical.pdf.voided.pdf`), so the canonical signed PDF is always
clean. The route never reads or writes storage. The happy-path test
asserts this positively: `storageDownloads.length === 0 &&
storageUploads.length === 0` even when the seeded row is a previously
signed contract with `signed_at` non-null.

### RPC — `restore_contract(p_contract_id uuid, p_restored_by uuid)`

`supabase/migration-build68b-contract-restore-rpc-and-event-type.sql`
(applied to prod). Pattern mirrors build59 `void_contract`:

```sql
DECLARE v_org uuid; v_job_id uuid;
        v_signed_at timestamptz; v_first_viewed_at timestamptz; v_sent_at timestamptz;
        v_target text;
BEGIN
  SELECT organization_id, job_id, signed_at, first_viewed_at, sent_at
    INTO v_org, v_job_id, v_signed_at, v_first_viewed_at, v_sent_at
    FROM contracts WHERE id = p_contract_id;
  IF v_org IS NULL THEN RAISE EXCEPTION ...; END IF;

  IF v_signed_at IS NOT NULL THEN v_target := 'signed';
  ELSIF v_first_viewed_at IS NOT NULL THEN v_target := 'viewed';
  ELSIF v_sent_at IS NOT NULL THEN v_target := 'sent';
  ELSE v_target := 'draft'; END IF;

  UPDATE contracts
    SET status = v_target,
        voided_at = NULL,
        voided_by = NULL,
        void_reason = NULL
    WHERE id = p_contract_id AND status = 'voided';
  IF NOT FOUND THEN RAISE EXCEPTION 'restore_contract: contract % is not voided', ...; END IF;

  INSERT INTO contract_events (organization_id, contract_id, event_type, metadata)
  VALUES (v_org, p_contract_id, 'restored',
          jsonb_build_object('restored_by', p_restored_by, 'target_status', v_target));

  UPDATE jobs SET has_pending_contract = EXISTS(
    SELECT 1 FROM contracts c
    WHERE c.job_id = v_job_id AND c.status IN ('sent', 'viewed')
  ) WHERE id = v_job_id;
END;
```

**Two design decisions worth flagging:**

1. **`voided_at` / `voided_by` / `void_reason` ARE CLEARED.** Eric
   confirmed this explicitly when asked: clear them so the restored row
   looks clean (no "voided by X" ghost text rendering anywhere); audit
   trail lives in `contract_events` (the prior `'voided'` row + the new
   `'restored'` row form the full history). Symmetric with
   `void_contract` which sets them — `restore_contract` clears them.

2. **The derivation rule is duplicated** between the TS pure function
   (`restore-target-status.ts`) and the RPC body. Both must stay in
   sync. A comment in each points at the other. Single-source via a
   PostgreSQL function exposed to JS was considered and rejected — the
   TS function needs to run in the browser (future UI optimism on
   restore) where there's no DB roundtrip.

### Migration — CHECK constraint extension

`migration-build68b-contract-restore-rpc-and-event-type.sql` also
ALTERs `contract_events.event_type` to accept `'restored'`. **Critical
discovery during prep:** the live CHECK constraint includes 14 values
beyond what the build33 source file shows — `paid`, `payment_failed`,
`refunded`, `partially_refunded`, `dispute_opened`, `dispute_closed`,
`estimate_sent`, `invoice_sent`, `estimate_trashed`, `estimate_restored`,
`estimate_purged`, `invoice_trashed`, `invoice_restored`,
`invoice_purged`. These were added by post-build33 migrations not
captured in any of the `supabase/migration-build*.sql` source files I
could find. The build68b migration explicitly preserves all of them
plus adds `'restored'`. Verified via direct query before writing:
`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname =
'contract_events_event_type_check'`. Constraint name confirmed:
`contract_events_event_type_check` (auto-named from build33's inline
declaration).

### UI — Voided menu + Restore action

`src/components/contracts/contracts-section.tsx`:

- **`{!isVoided && (...)}` gate REMOVED** — voided rows now render the
  `⋯` menu just like every other row.
- New `RotateCcw` lucide icon imported.
- Menu content branches updated:
  - `row.status === "draft"` → "Delete draft" (unchanged)
  - `row.status !== "draft" && row.status !== "voided"` → "Void
    contract" (added `&& row.status !== "voided"` so Void doesn't show
    on already-voided rows)
  - **NEW**: `isVoided` → "Restore" button (one click, no confirm
    dialog, no destructive color)
- `handleRestore(id)` mirrors `handleDeleteDraft`'s shape but POSTs to
  `/api/contracts/[id]/restore`, success toast "Contract restored",
  401 handling, 6-second error toast duration. Calls `setMenuId(null)`
  on entry so the menu closes immediately.
- `RowProps` extended with `onRestore: () => void`.
- ContractsSection wires `onRestore={() => handleRestore(row.id)}` on
  the row (the row owns the click; no dialog target state needed since
  there's no confirmation step).

**Per-#62 AC explicitly: no confirmation dialog.** The test asserts
`screen.queryByRole("dialog")` is null after the Restore click fires
the POST.

**Slice #63's "Permanently delete" placeholder is NOT included.** Eric
confirmed: just Restore. Adding a disabled placeholder is speculative
per the no-premature-features rule; slice #63 will add it when it
lands.

## Helpers' test pattern

The new `restore/route.test.ts` is the **third RPC-route consumer of
`makeSupabaseFake()`** (alongside the just-migrated `void/route.test.ts`
and `[id]/route.test.ts`). The chain-builder lift validated:

- ~290 lines of in-file fake setup dropped across the two existing
  route tests; both stay green identically.
- The helper's `selectFromCalls` tracker (introduced by slice 3's
  draft-delete test) is now available to all RPC-route tests for
  positive "did NOT consult this table" assertions — harmless when
  unused, useful when present.
- `makeAuthedFake()` + `makeUnauthedFake()` no longer duplicated.

The shape that lifted was deliberately narrow. `.update()`,
`.insert()`, `.order()`, `.limit()` — needed by `finalize.test.ts` for
direct UPDATE/INSERT testing — were **not** included. Tested against
the YAGNI rule: if slice #63 ends up needing storage `.remove([])`,
add it then.

## TDD cycles run

Strict RED → GREEN per cycle. Each test was written first against the
unwritten or partial implementation and turned GREEN with minimal code.

1. **Cycle 0 — helper refactor (no RED).** Extracted
   `makeSupabaseFake()` + auth helpers to
   `src/lib/contracts/__test-utils__/supabase-fake.ts`; migrated
   `void/route.test.ts` and `[id]/route.test.ts`. Full suite stayed
   green at **57/10** throughout the migration. Per the TDD skill rule
   "Never refactor while RED. Get to GREEN first." — we started green,
   so this is fine.
2. **Cycles 1-5 — `computeRestoreTargetStatus` branches.** One test
   per branch, signed → viewed → sent → draft → precedence. Implementation
   grew one `if` at a time. 5 tests added.
3. **Cycle 6 — `ContractEventType` extension.** Single-line union
   addition. Mechanical (no dedicated test; exercised transitively by
   the route + the migration's INSERT).
4. **Cycle 7 — Route 401 unauthed.** RED: import failure (`route.ts`
   doesn't exist). GREEN: stub the `POST` export with just the auth
   check.
5. **Cycle 8 — Route 404 missing.** RED: stub returns 200. GREEN: add
   the `from('contracts').select(...).eq('id', id).maybeSingle()` lookup
   with the `signed_at`/`first_viewed_at`/`sent_at` columns.
6. **Cycle 9 — Route 409 non-voided.** `it.each(['draft','sent','viewed','signed','expired'])`
   asserts all five non-voided statuses return 409 and never call the
   RPC. RED: all five fail. GREEN: add `if (contract.status !== 'voided')`
   guard.
7. **Cycle 10 — Route happy path + storage untouched.** Seeded a voided
   row with `signed_at` populated; asserted RPC was called with
   `{ p_contract_id, p_restored_by: user.id }` AND
   `storageDownloads.length === 0 && storageUploads.length === 0`. RED:
   200 with no RPC call. GREEN: add `supabase.rpc('restore_contract',
   { p_contract_id: id, p_restored_by: user.id })` with error → 500.
8. **Cycle 11 — Route 500 on RPC error.** Already passing after cycle
   10 (the 500 branch was wired together). Test still committed for AC
   coverage.
9. **Cycle 12 — UI voided menu + Restore action.** Single test asserts
   (a) voided row renders the `⋯` menu, (b) clicking it shows
   "Restore", (c) clicking "Restore" fires `POST /api/contracts/c-1/restore`
   with no `role="dialog"` rendered in between. RED: voided row has no
   menu. GREEN: remove `{!isVoided && ...}` wrapper, add `isVoided`
   branch to menu content, narrow the existing `row.status !== "draft"`
   Void branch to `&& row.status !== "voided"`, wire `handleRestore`.
10. **Cycle 13 (mechanical) — migration.** Wrote
    `migration-build68b-contract-restore-rpc-and-event-type.sql`.
    Verified constraint name + existing values via direct `pg_constraint`
    query before authoring the ALTER. Verified `restore_contract`
    doesn't already exist before authoring the CREATE OR REPLACE.
    Surfaced SQL summary in chat, requested plain-text approval per
    the prior session's classifier note, received "yes apply", applied
    via Supabase MCP. Post-apply verification:
    `SELECT (SELECT 1 FROM pg_proc WHERE proname = 'restore_contract'
    ...) AS fn_exists, ... LIKE '%restored%' AS check_has_restored;`
    returned `fn_exists=1, check_has_restored=true`.

## Auto-mode classifier note (confirmed for second time)

The Supabase MCP `apply_migration` classifier blocked prod again
unless plain-text approval was present in chat. AskUserQuestion
answers do not count — confirmed for the second straight session
(slice 3 + slice 4 on 2026-05-13). Memory saved:
**`feedback_supabase_mcp_prod_migration_approval.md`** — surface SQL
summary in chat before attempting the call, ask for plain-text
approval ("yes apply"), then call.

This pattern is now stable enough to bake into the workflow.

## Mechanical state at session end

- **Branch:** `main`.
- **HEAD at session start:** `2546ccc` (the slice-3 vault commit; in
  sync with `origin/main`).
- **HEAD at handoff write-time:** `2546ccc` (no commit yet — pending
  Eric review of the diff bundle).
- **`origin/main`:** `2546ccc` — will be 1 (or 2 with this vault
  commit) behind after the pending source commit, then in sync after
  push.
- **Working tree at handoff write-time:**
  - Modified: `src/app/api/contracts/[id]/route.test.ts` (helper
    migration), `src/app/api/contracts/[id]/void/route.test.ts`
    (helper migration), `src/components/contracts/contracts-section.test.tsx`
    (Restore test added), `src/components/contracts/contracts-section.tsx`
    (gate removed + Restore menu + handleRestore),
    `src/lib/contracts/types.ts` (`'restored'` added).
  - Untracked: `src/app/api/contracts/[id]/restore/` (route + tests),
    `src/lib/contracts/__test-utils__/` (shared fake helper),
    `src/lib/contracts/restore-target-status.ts` + `.test.ts`,
    `supabase/migration-build68b-contract-restore-rpc-and-event-type.sql`,
    plus the gitignored `out/`.
  - Net: `5 changed, 172 insertions(+), 356 deletions(-)` against
    HEAD before counting the new files (which add the restore feature
    + tests + helper + migration).
- **Tests:** 72 passing across 12 files (was 57 / 10 — **+15 tests
  across 2 new files + 1 expanded file + 1 expanded test file**).
  - New: `src/lib/contracts/restore-target-status.test.ts` (5 tests)
  - New: `src/app/api/contracts/[id]/restore/route.test.ts` (9 tests)
  - Expanded: `src/components/contracts/contracts-section.test.tsx`
    (was 2 → 3; added the Restore-flow test)
- **Lint:** clean across touched files.
- **Typecheck:** `tsc --noEmit` clean across the repo.
- **Migrations applied:**
  `migration-build68b-contract-restore-rpc-and-event-type.sql` applied
  to AAA prod `rzzprgidqbnqcdupmpfe`, verified post-apply.
- **Vercel deploys:** will auto-trigger on push. No UI regressions
  expected; the menu gate change is additive for voided rows and
  identical for every other row.
- **TestFlight pushes:** none.
- **GitHub state:** issue #62 will close at commit (pending Eric
  confirmation). **Issue #63 remains open** with `ready-for-agent`.
  **#58 still open** as the umbrella (closes when #63 lands).
- **Memories saved this session:** **1** —
  `feedback_supabase_mcp_prod_migration_approval.md` (the
  auto-mode-classifier prod-migration gate, now confirmed twice).

## Slice remaining for the next session

Only #63 left. Both #59+#60 and #61 and now #62 are closed.

- **#63 (Permanently delete voided)** — extends the existing
  `DELETE /api/contracts/[id]` route from slice #61 with a voided
  branch:
  - Adds payment-block via `assertJobHasNoPayments` (BEFORE the
    current `if (contract.status !== 'draft')` 409, so the voided
    branch hits the payment-block check the draft branch deliberately
    skips).
  - Adds storage cleanup of canonical + sidecar PDFs via
    `supabase.storage.from('contracts').remove([canonical, sidecar])`
    — note this means the shared `makeSupabaseFake()` helper will need
    a `storage.from(b).remove()` method added. Add it in the same
    commit as the route work.
  - Adds `PermanentlyDeleteDialog` confirmation modal — at that point
    it's the THIRD consumer of the confirm-dialog shape (alongside
    slice #61's `DeleteDraftDialog` and slice #59's `VoidContractDialog`).
    Extract a shared `ConfirmDialog` and migrate all three to it.
  - Adds "Permanently delete" menu item on voided rows (after
    "Restore") — this is the missing piece of the voided menu that
    slice #62 deliberately did NOT stub.
  - Reuses `delete_contract` RPC as-is (no new migration needed for
    the RPC; storage cleanup happens at the route layer).

## Open threads

Inherited from prior sessions, unchanged:

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

New this session (worth carrying):

- **`makeSupabaseFake()` will need `storage.from(b).remove([])` for
  slice #63** — small addition; co-locate with the slice #63 route
  test once written.
- **`contract_events.event_type` CHECK has 14 values beyond build33
  source** — paid/payment_failed/refunded/disputes/estimate-*/invoice-*.
  These came from migrations not captured in `supabase/migration-build*.sql`.
  If a future ALTER ever needs to recreate this constraint, query
  `pg_constraint` for the live definition rather than trusting the
  source files.

## Notes for the next session

- **Start with #63** — pick up directly. The PRD body on #58 has all
  the design decisions; you don't need to `/grill-me`.
- **The third confirm-dialog consumer is the moment to extract** —
  `ConfirmDialog` lifts cleanly from the existing two
  (`DeleteDraftDialog` in contracts-section.tsx, `VoidContractDialog`
  as its own file). Three implementations, identical Cancel/Confirm
  shape with red destructive button.
- **Don't skip the payment-block on the voided branch.** Slice #61's
  draft branch deliberately bypasses it (drafts have no audit weight),
  but voided contracts may have related invoices with recorded
  payments, and permanently deleting one with payments would orphan
  financial audit data. Slice #63 must re-introduce
  `assertJobHasNoPayments` for this code path.
- **Storage cleanup pattern:** `supabase.storage.from('contracts').remove(paths)`
  where `paths = [canonical, sidecar]` (and `sidecar` is only present
  when the contract was once signed and then voided — only then was
  the sidecar created by slice #60).
- **Pre-commit checklist:** prod migration (if any) needs plain-text
  approval from Eric before the MCP call. See
  [[feedback-supabase-mcp-prod-migration-approval]].

## Links

- **Parent issue:** [#58](https://github.com/ericdaniels22/Nookleus/issues/58) — open, umbrella.
- **Slice issues**:
  - [#59](https://github.com/ericdaniels22/Nookleus/issues/59) — **closed in `6562143`**.
  - [#60](https://github.com/ericdaniels22/Nookleus/issues/60) — **closed in `6562143`**.
  - [#61](https://github.com/ericdaniels22/Nookleus/issues/61) — **closed in `b297ed9`**.
  - [#62](https://github.com/ericdaniels22/Nookleus/issues/62) — **closes in pending commit (this session)**.
  - [#63](https://github.com/ericdaniels22/Nookleus/issues/63) — open, `ready-for-agent`.
- **Source commit:** pending — single bundle.
- **Migration:** `supabase/migration-build68b-contract-restore-rpc-and-event-type.sql` — applied to AAA prod.
- **Predecessor handoff:** [[2026-05-13-void-restore-delete-slice-3]].
- **Current state:** [[00-NOW]].
- **Files added this session:**
  - `src/lib/contracts/__test-utils__/supabase-fake.ts`
  - `src/lib/contracts/restore-target-status.ts`
  - `src/lib/contracts/restore-target-status.test.ts`
  - `src/app/api/contracts/[id]/restore/route.ts`
  - `src/app/api/contracts/[id]/restore/route.test.ts`
  - `supabase/migration-build68b-contract-restore-rpc-and-event-type.sql`
- **Files modified this session:**
  - `src/app/api/contracts/[id]/route.test.ts` (migrated to shared helper)
  - `src/app/api/contracts/[id]/void/route.test.ts` (migrated to shared helper)
  - `src/components/contracts/contracts-section.tsx` (menu gate + Restore)
  - `src/components/contracts/contracts-section.test.tsx` (Restore test)
  - `src/lib/contracts/types.ts` (`'restored'` added)
