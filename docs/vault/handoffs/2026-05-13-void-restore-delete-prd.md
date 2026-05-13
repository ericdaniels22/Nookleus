---
date: 2026-05-13
build_id: standalone (design + PRD only — no source changes)
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-13-finalize-refactor-implementation]]"]
---

# Void / restore / permanently-delete PRD — 2026-05-13 (evening)

## What this session was

Third session of 2026-05-13, after the morning (finalize design + agent
skills) and the afternoon (finalize implementation via `/tdd`). A
**design-only session that did not touch `src/`**. One artifact landed:
**GitHub issue [#58](https://github.com/ericdaniels22/Nookleus/issues/58)
`Feature: void / restore / permanently delete contracts from the job
view`** with the `ready-for-agent` label, published via `/to-prd` after
a nine-question `/grill-me` session.

No source commits this session. The vault commit for this handoff is
the only commit landing on `main`.

## What the user reported

> "In contracts within the job view, I am currently unable to delete
> drafts or void contracts. I also want to change how voiding / deleting
> contracts works."

Surface-level: a real bug in `src/components/contracts/contracts-section.tsx`.
The `…` menu's close-on-doc-click handler at lines 69-75 listens on
`mousedown` while the menu items only block `onClick`. So `mousedown`
on a menu item fires, the doc-listener closes the menu, the `click`
never lands. The user sees the menu open, taps Discard/Void, the menu
disappears, nothing happens. **One-line fix during implementation** —
switch the doc listener to `click`, or add `e.stopPropagation()` on
`onMouseDown` inside the menu panel.

Deeper: the lifecycle model itself is wrong. Today "void" is the only
way to throw a contract away; it's irreversible, leaves crossed-out
rows in the section forever, and **destroys the original signed PDF**
when applied to a signed contract (today's void route at
`src/app/api/contracts/[id]/void/route.ts:69-92` downloads the signed
PDF, stamps a watermark, and re-uploads at the same path — overwriting
the original). Drafts (failed-send leftovers with no audit weight) get
the same heavyweight treatment as real signed contracts.

## The redesigned lifecycle

The user's upfront UX requirements set the model before grilling
started:

1. **Voided contracts remain visible (crossed out) in the Contracts
   section** — same as today's void behavior.
2. **A new "permanently delete" button** appears after a contract is
   voided. Click it → the row disappears from the section.
3. **A new "restore" button** appears after a contract is voided. Click
   it → un-cross-out, contract is alive again.

Plus the implicit fourth: drafts (failed-send leftovers) should be
deletable without ceremony — this is what the user opened with ("can't
delete drafts").

So the new model is:

```
alive ──void──> voided ──permanent-delete──> gone
                  │
                  └──restore──> alive (status derived)
```

Drafts skip the void step entirely: **draft ──delete──> gone** in one click.

## The nine grilled decisions (full PRD body is on issue #58)

1. **Hard-delete, not soft-delete.** Permanent delete is
   `DELETE FROM contracts WHERE id = ?`. Cascades to
   `contract_signers` and `contract_events` via existing `ON DELETE
   CASCADE` FKs from build 33 (`migration-build33-contracts.sql:54,77`)
   — no schema migration needed for cascade behavior. Considered a
   `deleted_at` tombstone column; rejected. Rationale: `no real
   customers yet` posture, no audit chain to preserve, soft-delete
   sprinkles `WHERE deleted_at IS NULL` everywhere for nothing.

2. **Signed-PDF watermark goes to a sidecar path on void.** The current
   void flow's overwrite of the canonical PDF is the bug that makes
   "restore a signed contract" definitionally broken. New behavior:
   stamp the watermark to `${signed_pdf_path}.voided.pdf` (or
   equivalent sibling key) and leave the canonical path untouched.
   Restore is trivial — canonical PDF is already clean. Permanent
   delete cleans up both. Existing voided-signed prod rows: zero (per
   `project_no_real_customers_yet`), so no backfill needed.

3. **Restore target status is derived from timestamps, not stored.**
   No `voided_from_status` column. The `restore_contract` RPC reads
   the row's preserved timestamps and computes:
   `signed_at` → `signed`; else `first_viewed_at` → `viewed`; else
   `sent_at` → `sent`; else `draft`. The void RPC already preserves
   all those timestamps. `expired` is a UI-side decoration only and
   needs no restoration target.

4. **Payment-block check applied to void + permanent-delete, not to
   restore.** Permanent-delete re-runs the same check at delete time,
   independently of when the void happened — covers the case where a
   contract was voided before any payments existed, then payments came
   in afterward. Restore is opposite of destruction, so it gets no
   block. The check itself extracts to a shared
   `assertJobHasNoPayments` helper to remove the inlined duplication
   that's currently at `void/route.ts:46-66`.

5. **Drafts get a one-click hard-delete shortcut.** Draft rows show
   "Delete draft" in the menu (not "Discard draft"); single
   confirmation; delete is direct. No void tombstone for drafts. The
   contract type still has `draft` as a valid status — only the UI
   flow is shortened. Drafts never produce a voided row.

6. **Light confirmation on permanent-delete.** Small "Are you sure?
   This can't be undone." dialog with Cancel / Delete. No type-the-title
   or admin-only gating. Rationale: it's already two clicks deep
   (must void first), the payment-block catches the worst footgun,
   user is solo with no real customers — friction-without-payoff at
   solo scale.

7. **No emails on void, restore, or permanent-delete.** All three
   actions are silent. The signing link going dead is enough signal
   for the signer (`build-public-signing-view.ts:156,209` already
   reject voided contracts with HTTP 410). User contacts the customer
   manually if needed.

8. **Both Restore and Permanently delete live behind the `…` menu**
   on voided rows. Voided rows currently hide the menu entirely
   (`contracts-section.tsx:404 — {!isVoided && ...}`); that gate gets
   removed. Considered (b) Restore inline + delete in menu and (c)
   both inline; rejected for the consistency-with-rest-of-section
   argument.

9. **No confirmation on Restore.** One click → toast → row un-crosses
   out. Restore is recovery from a mistake; making the user confirm
   "yes, I really want to undo my mistake" is friction without payoff.
   If the restore was wrong, voiding again is one click away.

## Module sketch confirmed (deep extractions)

The user confirmed the module list before publication:

**Backend (API routes)**
- `POST /api/contracts/[id]/void` — modify to call new sidecar-watermark helper.
- `POST /api/contracts/[id]/restore` — **new**. Calls `restore_contract` RPC.
- `DELETE /api/contracts/[id]` — **new**. Branches on current status: `draft` → delete (no payment check), `voided` → payment-block check + delete + storage cleanup, anything else → 409.

**Database (RPCs)**
- `void_contract` — unchanged.
- `restore_contract(p_contract_id, p_restored_by)` — **new**.
- `delete_contract(p_contract_id)` — **new**. Single transactional DELETE + has_pending_contract recompute.

**Types**
- `src/lib/contracts/types.ts` — `ContractEventType` gains `'restored'`.

**Frontend (`src/components/contracts/contracts-section.tsx`)**
- Fix the mousedown bug.
- Remove the `{!isVoided && ...}` gate.
- New menu items per status (Delete draft / Void contract / Restore + Permanently delete).
- New `PermanentlyDeleteDialog` component (light confirmation).
- Replace `handleDiscard` with `handleDeleteDraft`, `handleRestore`, `handlePermanentlyDelete`.

**Deep modules extracted for isolation testing**
- `computeRestoreTargetStatus(contract)` — pure function, four-branch timestamp derivation. The whole Q3 decision in one place.
- `assertJobHasNoPayments(supabase, jobId): Promise<void>` — shared payment-block helper, used by void + permanent-delete.
- `writeVoidWatermarkSidecar(supabase, signedPdfPath): Promise<{ sidecarPath }>` — replaces today's inline overwrite logic in the void route.

## Test scope confirmed (option C — full coverage)

The user picked the full-coverage option. Pattern mirrors the freshly-landed
`src/lib/contracts/finalize.test.ts` (commit `83b5312`, this morning):
in-file Supabase fakes scoped to exactly what each route touches, module-level
`vi.mock` for external deps, top-level `beforeEach` re-stamping after
`vi.clearAllMocks()`.

Files expected (paths TBD by implementer):
- Pure unit tests for `computeRestoreTargetStatus` — four branches plus edge cases.
- `restore` route integration tests — draft/sent/viewed/signed restore targets, signed-PDF preservation, `contract_events` row of type `'restored'`, `has_pending_contract` recompute, 404/409/401 paths.
- `delete` route integration tests — draft path no-payment-check, voided path with-payment-check, sidecar+canonical storage cleanup, has_pending_contract recompute, 404/409/401 paths.
- Modified void route — sidecar behavior tests (watermark lands on sidecar, canonical untouched), plus existing payment-block / 409-already-voided / auth paths continue to pass.

## Mechanical state at session end

- **Branch:** `main`.
- **HEAD at session start:** `693c5fd` (the afternoon vault commit).
- **HEAD at handoff write-time:** still `693c5fd` — **zero source commits this session**.
- **`origin/main`:** `693c5fd` (in sync).
- **Working tree:** clean except gitignored `out/`.
- **This handoff write becomes a single vault commit on top of `693c5fd`**, pushed to `origin/main` as the wrap-up.
- **Migrations:** none.
- **Vercel deploys:** none (docs/PR-only changes don't trigger).
- **TestFlight pushes:** none.
- **GitHub state:** **issue #58 created** with `ready-for-agent` label. The five-label triage vocabulary applies as-is.
- **Memories saved this session:** none — the design decisions live entirely in issue #58 + this handoff, which is the right home.

## Open threads

Most of these are inherited from the morning + afternoon. The only new
candidate is the implement-#58 work itself.

- **Implement #58 / the void-restore-delete refactor** — the natural next-session candidate. Mirrors the #57 flow: `/orient`, open the issue, execute via `/tdd` with vertical-slice cycles, land a single commit on `main`, close #58 with a commit pointer.
- **Durable secondary audit-write fallback** — `console.error` to Vercel logs is explicitly temporary, filed for ~Build 67. No change since this morning.
- **Manual email-resend flow** — out of scope for #57 and #58. Still no design.
- **`@testing-library/react` not installed** — `src/lib/mobile/use-capture-mode.test.ts` fails to transform. Pre-existing; fix is `npm i -D @testing-library/react` whenever the next mobile-test session lands.
- **TestFlight push** — Apple Dev Program enrolled since 2026-05-11; still deferred.
- **Portrait-lock Info.plist commit (`63bc89e`)** — still needs an Xcode rebuild.
- **Finding-B regression test** — visually verified, not airplane-mode-tested.
- **65b.1 follow-up list** (~6 items, inherited).
- **Step 5 Supabase email templates** — inherited.
- **AAA QB sandbox token** — expired 2026-04-21, inherited.
- **67c2 reviewer F4–F8** + **5xx redactor sweep across remaining ~80 routes** — inherited.

## Notes for the next session

- **The mousedown bug is the user-visible blocker today.** Even before the
  full #58 implementation lands, you could ship the one-line fix on its
  own and the Discard/Void buttons would start working again. The grilled
  design extends the model, but the bug-fix is decoupleable. Whether to
  split the work is the implementer's call — TDD'ing the full feature is
  cleaner; shipping the bug-fix first restores partial functionality
  faster.
- **The `finalize.test.ts` in-file Supabase fake is now the second
  consumer in waiting.** When implementing #58, lift the chain-builder
  pattern from `src/lib/contracts/finalize.test.ts:170-300` into each new
  test file inline — premature extraction to a shared helper is still
  the wrong call until a third consumer exists.
- **Cascade FKs are already in place** — confirmed via
  `migration-build33-contracts.sql:54,77`. The implementer does not need
  to write a migration for the cascade behavior; the DELETE just works.

## Links

- **Issue:** [#58](https://github.com/ericdaniels22/Nookleus/issues/58) — `ready-for-agent`, open.
- **Predecessor handoff:** [[2026-05-13-finalize-refactor-implementation]]
- **Current state:** [[00-NOW]]
- **Bug location (mousedown menu):** `src/components/contracts/contracts-section.tsx:69-75` (doc listener) + line 419 (menu panel `onClick` without `onMouseDown`).
- **Void route to be refactored:** `src/app/api/contracts/[id]/void/route.ts:69-92` (the overwrite-on-stamp block).
- **Test pattern reference:** `src/lib/contracts/finalize.test.ts` (commit `83b5312`).
