# Email buckets: Jobs is the default view, and bot mail collapses into sender groups — not an Updates bucket

**Status:** Accepted
**Date:** 2026-07-02

## Context

The email overhaul (#951) reworks how incoming mail is filed and read. The
existing model: four buckets on the `emails.category` column (general /
promotions / social / purchases), assigned once at sync by first-match rules
(`category_rules`), falling back to `general`; job linkage is a separate axis
(`emails.job_id` + `matched_by`). Two failures drove the rework: job and
insurance-claim mail — the mail the business actually runs on — had no bucket
of its own, and automated notification mail (Vercel, GitHub, CI, software
alerts) matched no rule, so it piled into General and buried the human
correspondence. The design mock showed an "UPDATES · GROUPED" section, which
raised the obvious question: should Updates become a bucket?

## Decision

1. **A Jobs bucket exists and is the default view.** Membership is job-linked
   (auto-matched or manually assigned — assigning a job moves the email in)
   **or merely claim-looking** (known carrier/adjuster senders, claim-number
   patterns), even before any Job exists to match — the first email about a
   brand-new claim is exactly the one that must not be missed. Opening the
   email page lands on Jobs. General remains the *filing* fallback for
   unrecognized mail; "default" means default view, never default filing.
2. **There is no Updates bucket.** Bot mail stays in whatever bucket it files
   to (typically General) and *renders* as collapsed **Sender groups** pinned
   below the human mail. Grouping is presentation only — the emails stay
   ordinary rows. A group keys on the **display-name + address pair**, not
   the address: vercel[bot] and GitHub CI both send from
   `notifications@github.com` and must stay separate groups. Bot senders are
   auto-detected (no-reply addresses, "[bot]" names, automated-mail headers)
   and user-managed in a visible Rules list. Read bot mail drains out of
   per-sender groups into a single "Older updates" row.
3. **Unread badges count human mail only.** Grouped bot mail carries its
   count on its own group row and never inflates bucket, Inbox, or nav
   badges. This deliberately makes the badge under-count raw unread mail:
   a nonzero badge means a person or a claim needs attention. Every badge
   consumer (sidebar, tabs/chips, mobile bottom nav, the iOS widget summary)
   must apply the same rule or the numbers visibly disagree.
4. **Corrections teach rules.** Moving a mis-filed email offers a one-tap
   "always file this sender here", creating a persistent sender rule that
   also re-files that sender's existing inbox mail.

## Considered options

- **Updates as a fifth/sixth bucket** — rejected. It keeps General's meaning
  clean but adds another place to check; collapsing groups in place solves
  the clog without a new destination, and matches how the owner triages.
- **Folding bot mail into Promotions** — rejected. Mixes CI failures worth
  seeing with marketing mail, and contradicts the mock's separation.
- **Grouping by address or domain** — rejected; merges genuinely different
  streams (see the `notifications@github.com` case above).

## Consequences

- The counts endpoint changes meaning, not just shape: unread aggregates
  exclude bot-sender mail. This is baked into every badge and the widget.
- Rollout needs a one-time backfill: claim-signal detection for the Jobs
  bucket and bot-sender detection over existing mail (the
  `category_backfill_completed_at` per-account pattern already exists for
  this).
- Because grouping is presentation, search, thread view, job assignment, and
  bulk actions keep operating on plain email rows — no schema change to the
  message store itself, only additive rules/sender tables.
