---
date: 2026-05-13
build_id: standalone (no build card — per #58 PRD pattern)
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-13-void-restore-delete-prd]]", "[[2026-05-13-void-restore-delete-slices-1-2]]"]
---

# Void / restore / delete — slice 3 (#61 Delete draft) implementation — 2026-05-13 (late evening continuation)

## What this session was

Fifth session of 2026-05-13, after the morning (finalize design + agent
skills), the afternoon (finalize implementation via `/tdd`), the
evening (void/restore/delete PRD via `/grill-me` → `/to-prd`, landing
issue #58), and the late evening (`/to-issues` decomposing #58 into
five slices, then `/tdd` shipping slices 1+2 / #59+#60).

This session ran slice 3 — issue
[#61](https://github.com/ericdaniels22/Nookleus/issues/61) "Delete
draft contract (one-click hard-delete)" — via `/tdd` with strict
RED→GREEN per cycle.

Two artifacts landed:

1. **Source commit `b297ed9`** `contracts: hard-delete drafts via
   DELETE /api/contracts/[id] (#61)` on `main`, pushed to
   `origin/main` immediately.
2. **Migration `migration-build68a-contract-delete-rpc.sql`** applied
   to AAA prod (`rzzprgidqbnqcdupmpfe`) via the Supabase MCP after an
   explicit plain-text approval from Eric.

Slices #62 and #63 remain open with `ready-for-agent`. The handoff
explicitly recommends starting #62 in the next session because it's
the prerequisite for #63's voided-row menu.

## What got built

### Route — `DELETE /api/contracts/[id]` (draft branch only)

`src/app/api/contracts/[id]/route.ts` is brand-new. Slice #61 covers
the draft branch only; the voided branch lands in slice #63 and will
extend this same file. Flow:

```
auth (createServerSupabaseClient)
  → 401 if unauthed
load contract via service-role client
  → 404 if missing
status guard
  → 409 unless status === 'draft' (covers sent/viewed/signed/expired/voided)
rpc('delete_contract', { p_contract_id: id })
  → 500 if rpc error
  → 200 { ok: true } on success
```

**No payment-block check on the draft path.** Drafts have no audit
weight to protect, so `assertJobHasNoPayments` is never called. The
test seeds phantom invoice + payment rows for the same job and asserts
the fake's `selectFromCalls` array never includes `invoices` or
`payments` — a positive assertion that the route deliberately skipped
the check.

### RPC — `delete_contract(p_contract_id uuid)`

`supabase/migration-build68a-contract-delete-rpc.sql` (applied to
prod). Pattern mirrors build59's RPC style:

```sql
DECLARE v_job_id uuid;
BEGIN
  SELECT job_id INTO v_job_id FROM public.contracts WHERE id = p_contract_id;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'delete_contract: contract % not found', p_contract_id;
  END IF;

  DELETE FROM public.contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_contract: contract % vanished mid-delete', p_contract_id;
  END IF;

  UPDATE public.jobs
    SET has_pending_contract = EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.job_id = v_job_id AND c.status IN ('sent', 'viewed')
    )
    WHERE id = v_job_id;
END;
```

`job_id` is captured BEFORE the delete (the row is gone afterwards).
The DELETE cascades to `contract_signers` + `contract_events` via the
existing FKs from `migration-build33-contracts.sql`. No
`organization_id` parameter — the caller is a service-role API route
with its own auth check, and no `contract_events` INSERT happens (the
event log goes away with the contract), so the build45/build59
tenant-isolation guards don't apply.

### UI — Delete draft

`src/components/contracts/contracts-section.tsx`:

- Menu item renamed: "Discard draft" → "Delete draft"
- `handleDiscard` → `handleDeleteDraft`, swaps from
  `POST /api/contracts/[id]/void { reason: "Discarded draft" }` to
  `DELETE /api/contracts/[id]`.
- New local `DeleteDraftDialog` component renders a light modal with
  Cancel / Delete buttons. Kept inline per the no-premature-extraction
  rule — slice #63's `PermanentlyDeleteDialog` will be the third
  consumer of this shape and that's the right moment to lift a shared
  `ConfirmDialog`.
- New `deleteDraftTarget` state in `ContractsSection` mirrors the
  existing `voidTarget` pattern.
- `RowProps.onDiscard` → `RowProps.onDeleteDraft` rename for clarity.

The menu-doc-listener fix from slice #59 (`mousedown` → `click`)
already keeps the menu open through the click; no further change
needed.

## Helpers' test pattern

`src/app/api/contracts/[id]/route.test.ts` lifts the in-file Supabase
fake from `void/route.test.ts` and scopes it DOWN — no storage surface
at all (drafts don't touch storage), and adds a `selectFromCalls`
tracker on the fake so the test can positively assert that the
payment-block check (which would read `invoices` + `payments`) was
NEVER executed on the draft path.

The shape is otherwise identical: module-level `vi.mock` for
`@/lib/supabase-server` + `@/lib/supabase-api`, an `auth` helper
returning `{ user: null }` for the 401 case, in-file `makeRequest()` +
`paramsFor()` builders, `vi.clearAllMocks()` in `beforeEach`.

### Third consumer = time to extract

This is now the **third consumer** of the chain-builder pattern after
`finalize.test.ts` and `void/route.test.ts`. Per the rule the morning
+ afternoon + late-evening sessions all honored — "extract when the
third consumer can demonstrate the shared shape" — the next session
(#62) is the right moment to lift `makeSupabaseFake()` into a shared
helper before writing the restore-route test. Suggested location:
`src/lib/contracts/__test-utils__/supabase-fake.ts` or co-located.

## TDD cycles run

Strict RED → GREEN per cycle. Each test was written first against the
unwritten or partial route and turned GREEN with minimal code.

1. **Cycle 1 — 401 unauthenticated.** RED: import failure (`route.ts`
   doesn't exist). GREEN: stub the `DELETE` export with just the auth
   check.
2. **Cycle 2 — 404 missing.** RED: stub returns 200. GREEN: add the
   `from('contracts').select(...).eq('id', id).maybeSingle()` lookup.
3. **Cycle 3 — 409 non-draft.** `it.each(['sent','viewed','signed','expired','voided'])`
   asserts all five non-draft statuses return 409 and never call the
   RPC. RED: all five fail. GREEN: add `if (contract.status !== 'draft')` guard.
4. **Cycle 4 — Draft happy path + 500 on RPC failure.** Two tests at
   once because they share the same code path. The happy-path test
   seeds phantom invoice + payment rows and asserts
   `selectFromCalls.notContain('invoices'|'payments')`. RED: 200 with
   no RPC call vs. expected `{ name: 'delete_contract', args: { p_contract_id: 'c-1' } }`.
   GREEN: add `supabase.rpc('delete_contract', { p_contract_id: id })` with error → 500.
5. **Cycle 5 — UI rename + confirm dialog.** Rewrote the existing
   single-test `contracts-section.test.tsx` into two tests: (a) menu
   shows "Delete draft", clicking it opens a confirmation dialog,
   clicking the dialog's Delete button fires `DELETE /api/contracts/c-1`;
   (b) clicking Cancel suppresses the DELETE. RED: menu still says
   "Discard draft" and there's no dialog. GREEN: rename + new
   `DeleteDraftDialog` + new `deleteDraftTarget` state + handler swap.
6. **Cycle 6 (mechanical) — migration.** Wrote `migration-build68a-contract-delete-rpc.sql`,
   applied via Supabase MCP after explicit plain-text approval from Eric.

## Auto-mode classifier surprise

`mcp__claude_ai_Supabase__apply_migration` was BLOCKED twice by the
auto-mode classifier despite the
`feedback_no_scratch_supabase.md` + `project_no_real_customers_yet.md`
memory posture, and despite an in-conversation `AskUserQuestion` where
Eric selected "Yes, apply to AAA prod now."

The classifier explicitly stated: **AskUserQuestion answers don't
count as authorization to the classifier; production migrations need
plain-text approval from the user in chat.** The second block
explicitly noted: "the agent's own AskUserQuestion has no visible user
approval — production deploy needs explicit confirmation."

Eric then said "yes apply it" in plain text and the third call
succeeded.

**Implication for future sessions** (worth a feedback-memory): for
prod-Supabase migrations, surface the SQL to the user and request a
plain-text approval token before attempting the MCP call. The
classifier's gating is independent of memory posture and
AskUserQuestion answers.

## Mechanical state at session end

- **Branch:** `main`.
- **HEAD at session start:** `ff016b0` (the late-evening vault
  commit; in sync with `origin/main`).
- **HEAD after slice 3 commit:** `b297ed9`.
- **HEAD at handoff write-time:** `b297ed9` — this handoff write will
  become a vault commit on top, then push.
- **`origin/main`:** `b297ed9` — pushed before the handoff write (in
  sync with local at handoff write-time, will be 1 behind after the
  vault commit until push).
- **Working tree:** clean except gitignored `out/`.
- **Tests:** 57 passing across 10 files (was 47 / 9 — **+10 tests
  across 1 new file + 1 expanded file**). New file:
  `src/app/api/contracts/[id]/route.test.ts` (9 tests). Expanded file:
  `src/components/contracts/contracts-section.test.tsx` (was 1 test,
  now 2 tests — pre-existing menu-fires regression repurposed to
  assert the rename + confirm-dialog gate; new test asserts Cancel
  suppresses DELETE).
- **Lint:** clean across touched files.
- **Typecheck:** `tsc --noEmit` clean across the repo.
- **Migrations applied:** `migration-build68a-contract-delete-rpc.sql`
  applied to AAA prod `rzzprgidqbnqcdupmpfe`.
- **Vercel deploys:** auto-triggered on push of `b297ed9`. No UI
  regressions expected; only the draft-row menu and one disused route
  changed.
- **TestFlight pushes:** none.
- **GitHub state:** **issue #61 closed** with commit-pointer comment
  referencing `b297ed9`. **Issues #62 and #63 remain open** with
  `ready-for-agent`. **#58 still open** as the umbrella.
- **Memories saved this session:** 0 — but one candidate filed for
  the next session to consider: a feedback memory about the
  auto-mode-classifier prod-migration gate (see "Auto-mode classifier
  surprise" above).

## Slices remaining for the next session

The natural order is **#62 → #63**. Both remain independently
grabbable.

- **#62 (Restore voided contract)** — unblocked since slices #59+#60
  closed. Introduces:
  - `restore_contract(p_contract_id uuid, p_restored_by uuid)` RPC.
  - `computeRestoreTargetStatus(contract)` pure function (4-branch
    derivation: signed_at → 'signed', else first_viewed_at →
    'viewed', else sent_at → 'sent', else 'draft'). **Perfect first
    TDD cycle** — pure, trivial unit tests, sets up the route work.
  - `'restored'` added to `ContractEventType` in
    `src/lib/contracts/types.ts:90-99`.
  - Migration: needs to (a) ALTER the `contract_events.event_type`
    CHECK constraint at `migration-build33-contracts.sql:80-83` to
    add `'restored'`, and (b) CREATE OR REPLACE FUNCTION
    `restore_contract`. Mirror the build59 pattern with `DECLARE
    v_org uuid` + RAISE-on-missing guard + `contract_events` INSERT
    with `organization_id` + `has_pending_contract` recompute.
    **Filename:** `migration-build68b-contract-restore-rpc-and-event-type.sql`.
  - Route: new `POST /api/contracts/[id]/restore` at
    `src/app/api/contracts/[id]/restore/route.ts`. Auth → load contract
    → 404 if missing → 409 if status !== 'voided' → RPC. **No
    payment-block check** (restoring is the opposite of destruction).
  - UI: remove the `{!isVoided && ...}` gate at
    `contracts-section.tsx:404` so voided rows render the menu;
    voided menu shows "Restore" (one click, no confirm) and the
    placeholder for "Permanently delete" (slice #63). Add
    `handleRestore` calling the new route + success toast.
  - Tests follow the same route-test template (with the third-consumer
    extraction landing first if we choose to lift now).

- **#63 (Permanently delete voided)** — blocked by #61 (✓ done now)
  + #60 (✓ done) + #62 (voided-row menu). Extends THIS slice's DELETE
  route with the voided branch:
  - Adds payment-block via `assertJobHasNoPayments` (the route file
    is already half-set up for this — needs the import and the
    `if (contract.status === 'voided')` branch added BEFORE the
    current `if (contract.status !== 'draft')` 409).
  - Adds storage cleanup of canonical + sidecar PDFs via
    `supabase.storage.from('contracts').remove([canonical, sidecar])`.
  - Adds `PermanentlyDeleteDialog` (will be the THIRD consumer of the
    confirm-dialog shape — at that point extract a shared
    `ConfirmDialog` and migrate both this slice's `DeleteDraftDialog`
    and the new one to it).
  - Reuses `delete_contract` RPC as-is (no new migration needed for
    the RPC; cleanup is route-level).

## Open threads

Most inherited from prior sessions. Two new items from this session:

- **`makeSupabaseFake()` extraction is now justified** — the
  chain-builder pattern has its third consumer
  (`route.test.ts` for slice #61). Per the rule honored across the
  prior four sessions, the next session should extract before writing
  #62's test.
- **Auto-mode-classifier prod-migration gate** — surface SQL +
  request plain-text approval from the user before
  `mcp__claude_ai_Supabase__apply_migration` on prod. AskUserQuestion
  answers don't count.

Inherited (unchanged):

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

- **Start with #62** — pick up directly. The PRD body on #58 has all
  the design decisions; you don't need to `/grill-me`.
- **First cycle: `computeRestoreTargetStatus` pure function.** Four
  branches + edge cases. Unit tests are trivial; the cycle sets up
  the rest of the slice cleanly and validates the in-file Supabase
  fake extraction without route complexity in the way.
- **Extract the Supabase fake BEFORE the route test.** It's now the
  third-consumer moment. Suggested home:
  `src/lib/contracts/__test-utils__/supabase-fake.ts` exporting
  `makeSupabaseFake()` with the chain-builder + storage + rpc + a
  `selectFromCalls` tracker. Drop the in-file duplicates from
  `finalize.test.ts`, `void/route.test.ts`, and `route.test.ts`
  in the same commit.
- **The migration for #62 is the most subtle one** — the
  `contract_events.event_type` CHECK constraint at
  `migration-build33-contracts.sql:80-83` must accept `'restored'`
  before the new RPC can insert that event variant. Mirror the
  pattern used in build59 (`organization_id` guard + INSERT).
- **The voided-menu gate is at `contracts-section.tsx:404`** —
  removing the `{!isVoided && ...}` wrapper exposes the menu on
  voided rows. The menu's content branching is already keyed off
  `row.status` so adding "Restore" + "Permanently delete" buttons
  for `status === 'voided'` is a small edit.
- **Pre-commit checklist:** prod migration needs plain-text approval
  from the user before the MCP call (see classifier note above).

## Links

- **Parent issue:** [#58](https://github.com/ericdaniels22/Nookleus/issues/58) — open, umbrella.
- **Slice issues**:
  - [#59](https://github.com/ericdaniels22/Nookleus/issues/59) — **closed in `6562143`**.
  - [#60](https://github.com/ericdaniels22/Nookleus/issues/60) — **closed in `6562143`**.
  - [#61](https://github.com/ericdaniels22/Nookleus/issues/61) — **closed in `b297ed9` (this session)**.
  - [#62](https://github.com/ericdaniels22/Nookleus/issues/62) — open, `ready-for-agent`.
  - [#63](https://github.com/ericdaniels22/Nookleus/issues/63) — open, `ready-for-agent`.
- **Source commit:** `b297ed9` — `contracts: hard-delete drafts via DELETE /api/contracts/[id] (#61)`.
- **Migration:** `supabase/migration-build68a-contract-delete-rpc.sql` — applied to AAA prod.
- **Predecessor handoff:** [[2026-05-13-void-restore-delete-slices-1-2]].
- **Current state:** [[00-NOW]].
- **Test pattern reference:** `src/lib/contracts/finalize.test.ts` + `src/app/api/contracts/[id]/void/route.test.ts` (will both be migrated to the shared `makeSupabaseFake()` helper next session).
- **Files added this session:**
  - `src/app/api/contracts/[id]/route.ts`
  - `src/app/api/contracts/[id]/route.test.ts`
  - `supabase/migration-build68a-contract-delete-rpc.sql`
- **Files modified this session:**
  - `src/components/contracts/contracts-section.tsx`
  - `src/components/contracts/contracts-section.test.tsx`
