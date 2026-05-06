---
date: 2026-05-05
build_id: 67d
session_type: focused
machine: Eric (TheLaunchPad)
related: ["[[build-67d]]", "[[build-66]]", "[[build-67c2]]"]
---

# Build 67d Planning Handoff — 2026-05-05

Pure planning session: brainstormed Build 67d (soft-delete + 30-day trash for estimates and invoices) into a locked design, then drafted a 27-task implementation plan. No code, no migrations applied. Two commits this session ahead of `origin/main` pre-handoff:

- `93e3c24` `spec(67d): soft-delete + 30-day trash for estimates and invoices`
- `054ee1c` `plan(67d): 27-task implementation plan for soft-delete + 30-day trash`

(Plus this handoff commit + the 00-NOW push-state marker that lands at handoff time.)

## What shipped this session

### Track 1 — Brainstorm → spec

`superpowers:brainstorming` skill walked seven A/B/C decision points in sequence; user answered each with a single letter. Locked decisions in §2 of the spec:

| # | Decision | Choice |
|---|---|---|
| 1 | Status eligibility for Trash | **A** — any status (draft, sent, paid, voided, converted) can be trashed |
| 2 | Estimate ↔ invoice linkage on trash | **A** — independent (no cascade); FK switches to `ON DELETE SET NULL` for hard-purge safety |
| 3 | Trash UI placement | **A** — global `/invoices` Trash filter chip + per-job `<EstimatesInvoicesSection>` "Show trashed" toggle |
| 4 | PDF Storage cleanup timing | **A** — at hard-purge only (Restore preserves signed-URL fidelity through 30-day window) |
| 5 | Void vs Trash coexistence | **B** — Trash subsumes Void in the UI; `voided` status + `voided_at` + `void_reason` columns kept for legacy rows but never written by 67d code |
| 6 | Permission gate | **A** — reuse `manage_estimates` / `manage_invoices`; no new perm keys |
| 7 | Cleanup of existing 67c1 orphans | **A** — out of scope for the build; one-off MCP `service.storage.from('pdfs').remove([...])` call separate |

Spec presented in 5 sections (schema → API → UI → audit/permissions → edge cases), each approved before moving on. Spec self-review caught three issues, fixed inline:
- `<VoidConfirmDialog>` is inline in `estimates-invoices-section.tsx:35-114`, not a separate file.
- Trash GET response shape uses `{ estimates: [...] }` / `{ invoices: [...] }` (matches build66's `{ jobs: [...] }`), not generic `{ rows: [...] }`.
- "Self-review pass" task replaced with `superpowers:code-reviewer` pass per 67c2 discipline.

Spec landed at `docs/superpowers/specs/2026-05-05-build-67d-soft-delete-estimates-invoices-design.md`.

### Track 2 — Implementation plan

`superpowers:writing-plans` skill produced a 27-task plan across 9 phases:

- **Phase 0 (Pre-flight, T1):** SQL captures of current `contract_events_event_type_check` list + the two convert-linkage FK definitions + the cascade-FK definitions on `estimate_sections`/`estimate_line_items`/`invoice_sections`/`invoice_line_items` + `contract_events` parent-FK shape. Output captured before drafting the migration.
- **Phase 1 (Migration, T2–T3):** Write `migration-build67d-soft-delete-estimates-invoices.sql` with exact captured constraint values, apply via Supabase MCP, smoke-verify schema delta.
- **Phase 2 (Types, T4):** Add `deleted_at` + `delete_reason` to `Invoice` + `Estimate` interfaces in `src/lib/types.ts`.
- **Phase 3 (Helpers, T5–T6):** `assertNotTrashed` route guard + shared `purgeEstimateStorage` / `purgeInvoiceStorage` storage cleaners under `src/lib/documents/purge.ts`.
- **Phase 4 (Estimate routes, T7–T10):** `POST .../delete`, `POST .../restore`, `GET /trash`, replace `DELETE` from void→hard-purge.
- **Phase 5 (Invoice routes, T11–T14):** Same set, plus net-new `DELETE` (no DELETE handler exists today on invoices).
- **Phase 6 (Mutating-route guards, T15–T16):** Sweep `assertNotTrashed` across every existing PUT/POST that mutates an estimate or invoice (~16 routes).
- **Phase 7 (Active-list filters, T17):** Add `.is("deleted_at", null)` to active-list reads only — read-by-id endpoints intentionally don't filter so the trash banner can render.
- **Phase 8 (UI, T18–T24):** `<TrashConfirmDialog>` + `<ForceDeleteConfirmDialog>` shared components → replace inline `<VoidConfirmDialog>` in `<EstimatesInvoicesSection>` → add "Show trashed" toggle + Restore/Delete-now inline actions → Trash filter chip on `/invoices` → read-only banner + Edit page redirect-when-trashed.
- **Phase 9 (Verification, T25–T27):** §11 manual test pass (12 tests) → `superpowers:code-reviewer` pass → one-off MCP cleanup of the 3 67c1 orphan PDFs (`INV-2.pdf`, `INV-3.pdf` only — `EST-7.pdf` corresponds to a live row and gets cleaned via the new trash flow).

Plan self-review checked spec coverage (every numbered deliverable maps to specific tasks), placeholder scan (clean), type consistency (helper names + prop names consistent across declaration and consumers), and surfaced one corrective: spec §6 calls the audit JSON column `payload`; the actual codebase uses `metadata`. Plan uses `metadata` throughout. Spec is mildly wrong but the plan is the load-bearing artifact, no separate spec fix needed.

Plan landed at `docs/superpowers/plans/2026-05-05-build-67d-soft-delete-estimates-invoices.md`.

## Decisions locked

All seven brainstorm decisions confirmed by user with explicit single-letter answers (Q1=A, Q2=A, Q3=A, Q4=A, Q5=B, Q6=A, Q7=A) plus Section 1–5 design approvals. See spec §2 for the full table.

## Open threads (carried forward into the build)

These are spec-level non-goals or known concerns that the implementation will encounter:

### From the build's own spec
- **Auto-trash of legacy `voided` estimates** — explicit non-goal. Existing voided rows stay; users manually trash if they want them gone.
- **Build-wide settings-pages consistency pass** — pre-existing 67c1 carry-over (most settings pages don't gate management buttons on permissions client-side). Not blocking 67d but worth a follow-up.
- **General "Storage health" admin tool** for finding objects with no DB row — Q7 option B; deferred. 67d closes the new-drift surface (every Storage write is paired with a DB row that the trash flow can clean), so future drift should be near-zero.
- **Hardening the rest of the ~80 unfiltered routes against `deleted_at`** — only routes touching estimates/invoices are in scope.

### Inherited from earlier builds
- **AAA QB sandbox token refresh** — still punted to Eric's OAuth flow. Once refreshed, run sync against `WTR-2026-0018-INV-3` to confirm the `[CODE] description` shape end-to-end.
- **C1 from 67c2: SendModal stays visually open after successful send.** Base-ui Dialog flips `data-closed=""` but `display: grid` and `visibility: visible` persist. Functional state correct (open=false). Small follow-up; no blocker.

### One spec correction discovered during plan-write
- **Spec §6 audit-row column name.** Spec refers to it as `payload`; the actual `contract_events` schema column is `metadata` (verified at `src/app/api/estimates/[id]/send/route.ts:172`). Plan uses `metadata` correctly. Don't trust spec §6 column name verbatim during execution — use the plan's code blocks.

## Mechanical state

| Knob | State |
|---|---|
| `main` HEAD pre-handoff | `054ee1c` (2 commits ahead of `origin/main`) |
| Working tree | clean (no uncommitted changes) |
| Migrations applied this session | none |
| Deployed to Vercel | n/a (no code shipped) |
| `tsc --noEmit` | n/a (no code touched) |
| Active workspace | Test Co (`a0…0002`) — leftover from 67c2 wrap, no impact |
| Test Co fixtures from 67c2 | still present (`WTR-2026-T67C2` job + 5 estimates A–E + 1 invoice) — fine to reuse for 67d §11 test pass, or wipe and recreate |
| 3 orphan PDFs from 67c1 | still in `pdfs/a0…0001/WTR-2026-0018/{EST-7,INV-2,INV-3}.pdf` — Plan Task 27 covers cleanup |

## Pointers

- **Spec:** `docs/superpowers/specs/2026-05-05-build-67d-soft-delete-estimates-invoices-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-05-build-67d-soft-delete-estimates-invoices.md` (27 tasks across 9 phases)
- **Pattern reference:** [[build-66]] (jobs soft-delete) — `supabase/migration-build66-soft-delete-jobs.sql`, `src/app/api/jobs/{trash/route.ts,[id]/{delete,restore,route.ts}/route.ts}`, `src/lib/jobs/purge.ts`, `src/lib/jobs/auth.ts`. Almost the entire 67d implementation is "build66 but for two different tables instead of one."
- **Predecessor handoff:** [[2026-05-05-build-67c2-2]]

## What's next

User stated at start of this handoff: **"We are going to start the build in a fresh session."** So the next session is the SDD-execution kickoff for 67d. Recommended path:

1. **Push** `main` → `origin/main` (the spec + plan + this handoff commit + the 00-NOW push-state marker).
2. Open a fresh Claude Code session in this repo.
3. Run `/orient` to load context from this handoff + 00-NOW.
4. Confirm execution mode: **subagent-driven (recommended)** to mirror 67b/67c1's hybrid-B discipline. Inline execution is fine for shorter runs but 27 tasks across 9 phases is the SDD sweet spot.
5. Begin with Phase 0 Task 1 — pre-flight SQL captures via Supabase MCP. Do NOT skip; the migration's CHECK list correctness depends on it.
6. After Phase 1 (migration applied), run `npx tsc --noEmit` once to confirm baseline is still clean before any TS edits land in Phase 2+.
7. Reuse the 67c2 Test Co fixtures for §11 (Task 25) unless they've been wiped.

## Notes for next session

- The spec→plan flow caught one corrective (column name) that plan-time grep would have missed if the planner trusted the spec verbatim. Worth keeping the habit: even when you wrote the spec yourself, grep an existing call site for any column or function name before pasting it into a plan code block.
- The Build 66 jobs implementation is genuinely the canonical reference. The 67d code blocks in the plan all derive from build66's existing files — when in doubt during execution, read the build66 file rather than improvising.
- **No tests framework.** Verification is `npx tsc --noEmit` clean + manual §11 test pass. Don't try to write `.test.ts` files; they'd be the only ones in the repo.
- The `assertNotTrashed` helper in Plan T5 and the active-list filter sweep in T17 are the two highest-risk tasks for "missed a call site" bugs. Grep `from("estimates")` and `from("invoices")` in `src/` after T15/T16/T17 to triple-check coverage.
- Plan T27 (orphan PDF cleanup) requires the real org id captured from `storage.objects` — don't paste the placeholder `a0000000-XXXX-…` into the actual MCP call.

## Links
- Build card: [[build-67d]]
- Current state: [[00-NOW]]
- Pattern source: [[build-66]]
- Predecessor: [[2026-05-05-build-67c2-2]]
