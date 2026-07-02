# The Document Ledger consolidates the job paper trail — one panel, four dot colors, actions live on document pages

**Status:** Accepted
**Date:** 2026-07-02

## Context

The job Overview tab stacked three full-width sections — Estimates &
Invoices (#384), Files, Contracts — plus a Reports section (#402), spending
~600px of height, much of it on oversized empty states. Sketch was not
represented at all. There was no at-a-glance answer to "what paperwork
exists on this job and what's stuck?"

Issue #974 proposed a condensed Document Ledger panel. Grilling the proposal
against the code surfaced facts the mockup missed: the "Estimates" section
is actually Estimates **& Invoices** — a converted estimate's row flips to
become the invoice's view/edit home, and the Financials tab deliberately
hides draft invoices; a Sketch is 1:1 with the Job (`UNIQUE(job_id)`, ADR
0025) and has no name or status; Photo Reports were already on the Overview,
must start from the Photos tab (ADR 0009), and their statuses are
`draft|generated` (no "shared"); contracts are *created through* the "Send
for Signature" / "Sign In Person" modals; and both removed sections carried
recoverable-trash UIs that exist nowhere else.

## Decision

1. **One Document Ledger panel replaces the Estimates & Invoices, Contracts,
   and Reports sections** on the Overview, directly below the Job Info /
   Contact / Insurance card. Four groups — Contracts, Estimates, Sketch,
   Photo Reports — as divided columns on `lg:` and stacked full-width
   sections below. Files stays its own section (a File is an upload from
   outside; a *document* is authored by Nookleus — see **Document Ledger**
   in CONTEXT.md) with its empty state shrunk to one dashed line.
2. **Invoices ride the Estimates column.** A converted estimate renders as
   its invoice row (number, total, invoice status), linking to
   `/invoices/[id]` — preserving #384's flip and ADR 0007's single billing
   entry point. No fifth column, no Financials-tab widening.
3. **The Sketch group holds at most one row** — "Sketch · <total SF> ·
   updated <date>" — because a Sketch is 1:1 with the Job. Floors are not
   documents and never appear as rows or counts. "+ New sketch" renders
   only when none exists. The **Sketch tab is removed** from the job tab
   bar: the ledger row (or its "+ New sketch") is the entry point to the
   full-screen plan canvas (ADR 0026); deep links from estimate pull flows
   are unaffected.
4. **Four dot colors, mapped from each kind's real status enum** in one
   shared module (`src/lib/document-status.ts`) — never a synthetic unified
   enum ("awaiting"/"approved"/"shared" don't exist and lose information).
   Green = terminal good (signed, paid, generated). Amber = waiting on a
   human — sent/viewed contracts (you chase signatures), expired links,
   partial payments; amber anywhere in a group lights the group header,
   making the panel double as a to-do signal. Blue = in flight (sent
   estimates/invoices). Gray = draft, voided, or statusless (the Sketch).
   Deliberately no red dot — `--destructive` stays reserved for errors and
   overdue money. Full spec in design-system.md §2.6.
5. **Rows are pure links; actions move to the document pages.** Per-row
   trash/void/resend/remind buttons do not exist in the ledger. Restore
   stays on the Overview as a muted "Trash (N)" expander per group (only
   when non-empty). Trashing/voiding a document happens from its detail
   page — which adds a trash action to the report editor and lifecycle
   actions (resend/remind/void) to `/contracts/[id]/view`, where none
   existed. Contract *creation* stays on the Overview: the Contracts
   group's "+ New" opens a two-item popover (Send for Signature / Sign In
   Person) launching the existing modals. "+ New report" navigates to the
   Photos tab per ADR 0009's photos-first flow.
6. **One new route, no view.** `/api/jobs/[id]/document-ledger` runs the
   four source queries in parallel server-side and returns normalized rows
   plus per-group trash counts. A `job_ledger_documents` Postgres view was
   rejected (migration + RLS surface for no gain); pure client-side reuse
   of existing endpoints was rejected (~6 requests with signer/geometry
   over-fetch on every job open). "See all →" ships later with a real
   Documents view — the header is not a link.

## Consequences

- The Overview answers "what paperwork exists and what's stuck?" in one
  panel height (~140–180px with 2 docs per type) instead of ~600px.
- Draft invoices remain reachable (via their flipped estimate rows) even
  though the Financials tab hides them.
- The dot vocabulary is app-wide: the jobs dashboard and future document
  lists must import `src/lib/document-status.ts`, not restate colors.
- Document pages gain the destructive/lifecycle actions their Overview
  rows used to carry; until those land, the ledger cannot ship without
  regressing report-trash (the Overview was the only place to trash a
  report).
- Amber is intentionally opinionated: a sent contract is "waiting on a
  signature", not "in flight". If chase-semantics ever change, the mapping
  changes in one module.
