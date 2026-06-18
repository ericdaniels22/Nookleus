# Labor hours classify into Regular and one Premium tier, in one Organization timezone

**Status:** Accepted
**Date:** 2026-06-17 (grilling session for the per-Job timesheet PRD — issue #699)

A **Job timesheet** splits each worker's hours into billing tiers. Two
non-obvious choices are worth recording: there is exactly **one** premium tier
(overtime and after-hours do not stack), and all classification is computed
against a **single Organization timezone**, never the recording device's clock.

## Context

Most payroll and time systems model overtime and night/weekend premiums as
separate, stackable multipliers (e.g. 1.5× overtime, 2× Sunday, compounding to
3×), and they classify against wherever the clock physically is. This
Organization bills differently and operates differently, so the feature deviates
from both norms — and an engineer porting payroll intuition would "fix" this into
stacking multipliers and device-local time unless the deviation is recorded. This
is a billing-practice rule, not a legal one (it is explicitly **not** payroll).

## Decision

1. **Two tiers only: Regular and Premium.** Regular = Monday–Friday, 7am–5pm, up
   to 8 hours in a calendar day. Premium = everything else: before 7am or after
   5pm on a weekday, *all* hours on Saturdays, Sundays, and the 11 US federal
   holidays (observed dates), or any hours past 8 in a calendar day.
2. **Premium is a single rate; reasons label but never stack.** The Organization
   bills overtime and after-hours at the same rate, so a premium stretch carries a
   human-readable reason (overtime / evening / weekend / holiday) for the
   reviewer, but an hour is Premium *once* — a Saturday hour past the 8th is not
   "double premium." This is also why business hours start at **7am**: an early
   start must not be penalised into a higher tier, because there is no higher tier
   and the owner will not charge a homeowner premium merely for starting early.
3. **Classified server-side against one authoritative Organization timezone.** A
   new per-Organization timezone setting (defaulted from the business address) is
   the single zone hours are bucketed in. The 7am/5pm boundaries, the day-of-week,
   the >8h/day cap, and the holiday calendar are all evaluated against that zone —
   never the recording device's clock — so the same session yields identical hours
   regardless of whose phone captured it or where they were. Sessions are summed
   per calendar day for the daily cap; a session crossing midnight is split at the
   day boundary; overtime is daily-only (no weekly accumulator).

## Consequences

- A **new authoritative Organization setting** (timezone) is introduced and must
  be defaulted sensibly from the business address; classification depends on it
  and must never silently fall back to device-local `new Date()`. The codebase
  already has a documented UTC-vs-local "previous calendar day" trap
  (`src/lib/date-field.ts`), so the boundary math must be written against the
  Organization zone explicitly rather than the host's.
- A maintained **US federal-holiday calendar** (observed dates) becomes part of
  the billing logic — a small data dependency that has to be kept current.
- Because there is no stacking, the model cannot express a customer or
  jurisdiction that genuinely pays, say, 2× on Sundays *on top of* overtime. That
  is a deliberate simplification matching how this Organization bills; revisit only
  if a multi-rate premium is ever actually billed.
- The thresholds (7am–5pm, 8h/day, the federal-holiday set) are business rules,
  not law, and live in one place so they can be tuned to the owner's billing
  practice.

## Considered options

- **Stacking multipliers (separate overtime, evening, weekend, holiday rates).**
  Rejected: the Organization bills all premium time at one rate, so multiple tiers
  would be machinery with no billing meaning — and a future source of disputes
  ("why is this hour billed 3×?").
- **Classify in each device's local timezone.** Rejected: a crew member
  travelling, a misconfigured phone, or plain UTC drift would silently mis-bucket
  hours and make two people's records of the same day disagree. One Organization
  zone is the only way the math is reproducible and defensible.
- **Weekly overtime (>40h/week) in addition to daily.** Rejected for v1: the owner
  bills daily (>8h/day); a weekly accumulator adds state and reconciliation with no
  stated need. Left as a future option.
- **A 9am start or no business-hours floor.** Rejected: the owner specifically
  does not want to charge a homeowner premium for an early-morning start, which a
  9am floor — or an after-5pm-only rule with no morning boundary — would get
  wrong in opposite directions. 7am–5pm matches the actual billing intent.
