# 0007 — Estimates are the single entry point for billing; invoices are conversion-only

**Status:** Accepted
**Date:** 2026-06-03

## Context

Issue #379 reworks how Estimates and Invoices relate. Today they are two
independently-creatable documents per Job: an Invoice can be authored directly
(`/invoices/new`, `create_invoices` permission) or produced by converting an
Estimate (a copy with two-way links — `converted_to_invoice_id` /
`converted_from_estimate_id`). The Job's **Overview** tab shows two parallel
tables (estimates and invoices), and a standalone `/invoices` page lists every
invoice across all jobs.

The foundational question was whether an Invoice is a thing you *author* or a
thing an Estimate *becomes* — and, if the latter, whether the two collapse into
one record or stay distinct.

## Decision

**An Invoice can only be created by converting an Estimate.** Direct authoring
is removed.

- **The Invoice stays a separate record**, not merged into the Estimate. It keeps
  its own due date, payment state (`draft → sent → partial → paid → voided`),
  void-with-reason, and QuickBooks sync.
- **Strictly 1:1.** An Estimate yields at most one Invoice. Deposits and progress
  billing are **partial payments against that single Invoice**, never additional
  Invoices.
- **The Overview tab drops the invoices table.** The Estimate row is the working
  document; on conversion it **flips to represent the Invoice** and becomes the
  view/edit surface. The original Estimate is kept as a frozen, viewable record
  (reached via the existing cross-link).
- **An Invoice becomes official only when manually marked sent.** Until then it
  is a draft living in Overview; it does **not** appear in the Financials tab and
  does **not** count toward "Invoiced." "Sent" is a manual flip — there is no
  requirement to email it from the app, and recipients are not modelled.
- **The Financials tab tracks the sent Invoice** alongside payments and expenses.
  The job's **Invoiced** figure — and the org-wide profitability dashboard —
  count **sent-or-later Invoices only** (drafts and voided excluded).
- **Row status colours are minimal:** yellow = converted Invoice awaiting review
  (draft), blue = sent. Estimate rows and all other states are untinted. The
  estimate **approved/rejected** step is dropped (draft → convert).
- **The standalone `/invoices` list is removed.** Invoices are reached only
  through their Job.

See the **Estimate** and **Invoice** entries in [CONTEXT.md](../../CONTEXT.md).

## Consequences

- Editing the Invoice keeps the existing guard — **no edits once paid or
  voided** — now reached through the flipped Overview row.
- Counting only sent-or-later Invoices **fixes current over-counting**: today
  [`margins.ts`](../../src/lib/accounting/margins.ts) sums every non-deleted
  invoice regardless of status, so drafts and even voided invoices inflate
  "Invoiced". This rule applies to both the per-job summary and the
  profitability roll-up.
- `create_invoices`, `/invoices/new`, and the `/invoices` list page are retired;
  `convert_estimates` becomes the sole creation path.
- Cross-job collections rely on the accounting dashboard's **AR aging**, which
  already answers "who owes us across all jobs."
- The estimate↔invoice cross-links remain; the "view original estimate" link
  off a flipped row uses them.
- The PDF "notes column" scaffold and the `PdfPreset` system are **out of scope**
  for this ADR (they belong to issue #379's other two asks — line-item notes and
  the PDF view rework).

## Alternatives considered

- **(B) Merge Estimate and Invoice into one record that flips state.** Rejected:
  Invoices carry payment reconciliation, due dates, QuickBooks sync, and
  void-with-reason that Estimates don't. Merging means rebuilding all of it and
  migrating live financial data for little real gain. "An indicator showing that
  an estimate has been converted" describes *pointing at* an Invoice, not
  *becoming* one.
- **Multiple Invoices per Estimate** (deposit/progress invoices as separate
  documents). Rejected for now: deposits and draws are modelled as partial
  payments on the single Invoice. Insurance jobs rarely pay in full anyway, so
  partial-payment tracking already fits the reality.
- **Keep the standalone `/invoices` list read-only.** Rejected: AR aging on the
  accounting dashboard already covers the cross-job collections view.
- **Surface the Invoice in Financials at conversion.** Rejected: a draft Invoice
  is not a real receivable — only a sent Invoice is official.
