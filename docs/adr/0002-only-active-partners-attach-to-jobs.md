# 0002 — Only Active Referral Partners can be attached to a Job

**Status:** Accepted
**Date:** 2026-05-26

## Context

Issue #296 adds a Job ↔ Referral Partner relationship so the team can
track who sent us which project. Under the glossary's Model A, a single
database row is called a **Target** while its Lifecycle status is
Uncontacted (grey) or In progress (yellow), and becomes a **Referral
Partner** the moment it flips to Active (green).

When the user logs a job, the picker for "who referred this job" could
plausibly:

- (A) show every non-Declined row regardless of status,
- (B) show only Active rows, or
- (C) show every non-Declined row and auto-flip a chosen Target to
  Active on attach.

## Decision

The Job referrer picker shows **only Lifecycle = Active rows**. To
attach a yellow Target, the user must first flip the row to Active on
the Referral Partner Worksheet. The picker may include a "+ Promote
and attach" affordance for yellow rows so the explicit promotion is
one click away, but the status change is still a deliberate user
action.

## Consequences

- The wording on the picker ("Add Referral Partner") stays literally
  accurate — only Referral Partners (Active rows) appear there.
- The Referral Partner Worksheet's rule of *no automated Lifecycle
  transitions* (PRD #249) is preserved. Every grey→yellow→green→red
  flip remains a deliberate click.
- A small ergonomics cost: logging a job from a brand-new lead is a
  two-step flow (promote, then attach) rather than one.
- The referral tracker count (item 4 of #296) only ever credits
  Active rows, which matches the natural meaning of "how many jobs
  has this Partner sent us."

## Alternatives considered

- **(A) Allow any non-Declined row.** Rejected: makes the word
  "Referral Partner" on the picker mean "Target or Partner", which
  fights the glossary.
- **(C) Auto-promote yellow → green on attach.** Rejected: violates
  the Worksheet's no-automated-transitions rule and hides a meaningful
  business event behind a side effect.
