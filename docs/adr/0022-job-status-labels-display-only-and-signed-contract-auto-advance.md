# Job-status labels are display-only; signing a contract auto-advances Lead or Lost to Active

**Status:** Accepted
**Date:** 2026-06-19 (grilling session for the job-status relabel — `/grill-with-docs`)

The five **Job status** stages (**Lead → Active → Collections → Closed →
Lost**) are a pure **relabel** of the existing vocabulary: only the
org-scoped `job_statuses` display labels (and colors/icons/order) change,
while the underlying snake_case keys — `new`, `in_progress`,
`pending_invoice`, `completed`, `cancelled` — stay exactly as they are.
Separately, signing a contract becomes the one automatic status move: it
advances a **Lead** (or revives a **Lost** job) to **Active**, and never
drags a job that is already further along backward.

## Context

A Job's lifecycle stage is free-text `jobs.status` (no CHECK constraint, no
FK). The human-facing vocabulary lives in the per-Organization
`job_statuses` table (`name` key / `display_label` / `bg_color` /
`text_color` / `sort_order` / `is_default`), seeded with five rows whose keys
are `new` / `in_progress` / `pending_invoice` / `completed` / `cancelled`.
Those keys are also hardcoded as string literals across ~12 code sites — the
phone-tab `ACTIVE_STATUSES` sets, Jarvis tools, accounting margins, the
dashboard `new`-count, and an RLS view that filters
`status not in ('completed','cancelled')` — so the keys are a de-facto API
that a rename would have to chase everywhere, plus a data migration over every
existing job row.

The owner asked for a "1-to-1 rename with some automations," not new stages.
Because labels already render through `job_statuses` + `config-context.tsx`,
the rename is achievable entirely at the display layer with **zero** churn to
the keys, the ~12 call sites, the RLS view, or existing data.

Today the only writer of `jobs.status` is a person (the job-detail dropdown).
The owner wants signing a contract to move the job forward on its own — but
only forward, and only from the two states where "we just won the work" is
true: a fresh **Lead**, or a **Lost** deal that came back to life.

## Decision

1. **Relabel by editing `job_statuses` display columns only; never the
   `name` keys.** `new` displays as **Lead**, `in_progress` as **Active**,
   `pending_invoice` as **Collections**, `completed` as **Closed**, and
   `cancelled` as **Lost 😢**. The keys, the ~12 hardcoded key sites, the
   unread-threads RLS view, and all existing `jobs.status` data are
   untouched. `config-context.tsx` (`getStatusLabel` / `getStatusColor`) plus
   the `job_statuses` rows remain the single source of truth for how a key
   renders; the hardcoded status dropdown in `job-detail.tsx` must be made
   config-driven so it reads these five labels instead of carrying its own
   copy.

2. **Signing a contract is the one automatic status move, and it only moves
   forward.** When a contract is marked signed, if the Job's status is `new`
   (**Lead**) **or** `cancelled` (**Lost**), set it to `in_progress`
   (**Active**). If the Job is already `in_progress`, `pending_invoice`, or
   `completed`, signing leaves the status untouched — it never moves a job
   backward. Every other transition (into Collections, Closed, Lost, or any
   manual correction) stays a deliberate user choice; no money event auto-moves
   status.

## Consequences

- **A future reader will see `jobs.status = 'cancelled'` rendering as
  "Lost 😢" and `pending_invoice` rendering as "Collections," and must not
  "fix" it.** The key↔label divergence is deliberate, recorded here, and
  centralized in `job_statuses` + `config-context.tsx`. Any new lifecycle
  logic must branch on the snake_case **keys**, never on the display labels.
- **The auto-advance adds a second writer of `jobs.status`** (previously
  user-only). It must fire at the single signing choke point and be
  idempotent, because a contract can be finalized through more than one path
  (the `mark_contract_signed` RPC in `migration-build33-contracts.sql` and the
  `src/lib/contracts/finalize.ts` write path). Re-running a sign must not
  re-advance or otherwise change a status that has since moved on.
- **Reviving a Lost job on signing is intentional**: a deal marked Lost that
  later signs re-enters the live pipeline at Active rather than being stranded
  as dead. This is the only path that moves a job *out of* a terminal-looking
  state automatically.
- **Sort order, default visibility (hiding Closed/Lost), the per-stage
  filter, and the visual treatment are UI concerns, not recorded here** —
  they are easily reversible and live in the PRD, not this ADR.

## Considered options

- **Rename the database keys to `lead`/`active`/`collections`/`closed`/`lost`.**
  Rejected: it buys nothing a user can see (labels already come from
  `job_statuses`) while forcing a data migration over every Job row plus a
  rewrite of ~12 hardcoded `status === '…'` sites and an RLS view — real risk
  on a live system for cosmetic key-tidiness. Keeping the keys is the safe,
  reversible choice; the labels can be re-tuned freely without ever touching
  data or code.
- **Lock the vocabulary with a CHECK constraint or FK to `job_statuses`.**
  Rejected (out of scope): the vocabulary is intentionally org-editable and
  dynamic; constraining it is a separate decision with its own trade-offs.
- **Let signing advance *any* status to Active.** Rejected: it would drag a
  billed (Collections) or finished (Closed) job backward into Active, which is
  wrong — signing is only meaningful as the Lead→Active gate (plus the
  Lost-revival case).
- **Advance only Lead→Active; leave Lost alone.** Rejected: the owner
  explicitly wanted a resurrected deal to climb back into the pipeline
  ("Lead OR Lost moves up").
- **Auto-move further down the pipeline on money events (payment →
  Collections, paid → Closed).** Rejected: the owner chose to keep every
  money-related transition manual; only the signing gate is automated.
