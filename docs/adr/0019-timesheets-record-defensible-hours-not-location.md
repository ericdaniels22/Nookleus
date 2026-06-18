# Job timesheets prove hours worked, not location

**Status:** Accepted
**Date:** 2026-06-17 (grilling session for the per-Job timesheet PRD — issue #699)

Nookleus is adding per-Job timesheets so an Organization can send an insurance
reviewer a defensible record of the labor hours behind an Invoice (see the new
glossary terms **Job timesheet** and **Time session**). The obvious instinct for
an "insurance-grade" record is to GPS-stamp every clock-in to prove a worker was
physically on site. We are deliberately **not** doing that.

## Context

The app already takes a deliberate no-location stance: **Photos carry no GPS**
(a Photo Report records "location captured" as the Job's property address, not
coordinates), and the product stores no other position data. An insurance
timesheet is the one surface where a reviewer might *expect* a location stamp, so
its absence will read as an oversight to a future engineer unless it is recorded
as a choice.

## Decision

1. **A Job timesheet substantiates hours, not presence.** Its evidentiary weight
   comes from defensible, auditable time records — who, which Job, clock-in and
   clock-out, how each **Time session** was captured (live clock vs hand-entered),
   a full edit audit trail, and an owner/lead **certification** with signature —
   not from any geographic proof that a person stood at a coordinate. No
   latitude/longitude is captured, stored, or printed.
2. **Times are never fabricated, and that is the integrity story.** Crew members
   can only live-clock *themselves* in and out; a missing or wrong time is fixed
   only by a lead/admin **Correction**, which is audit-logged (who, when, old →
   new) and visibly marked as hand-entered on the sheet. Every hour being
   traceable to a live tap or a named human's hand-entry is what survives a harsh
   review — in place of GPS.
3. **Location is reserved strictly for a future clock-in *assist*, never as
   evidence.** A planned fast-follow may use the device's foreground location to
   *suggest* the nearest Job when a worker taps "Clock in" (so crews stop clocking
   into the wrong Job). That is a convenience hint computed on-device; it is not
   recorded on the session and never appears on the timesheet. Background "you
   left the site" geofencing is deferred further still.

## Consequences

- The timesheet's defensibility rests entirely on **audit quality**:
  immutable-once-signed PDFs (the same rule as signed contracts —
  [ADR 0011](0011-signed-contract-pdfs-are-immutable.md)), the capture-method
  marker on every session, and the edit audit log. Those must be solid because
  there is no GPS fallback to lean on.
- We avoid the privacy, battery, and iOS always-on-location-permission costs of
  tracking worker positions — and the liability of holding employee location
  histories.
- If an insurer ever specifically demands geo-proof, this is the decision to
  revisit — and it would be a genuinely new posture (location as a stored
  evidentiary fact), not a small toggle, which is exactly why it is recorded here.

## Considered options

- **GPS-stamp each clock-in as on-site proof.** Rejected: it breaks the app's
  standing no-location stance for marginal evidentiary gain (a coordinate proves a
  phone's position, not who worked or for how long), and it imposes always-on
  location permission, battery drain, and the liability of storing staff location
  trails.
- **Geofence the Job site and auto-clock in/out on arrival/departure.** Rejected
  for v1: it needs always-on background location and push, and it still does not
  make the *hours* more honest — it just relocates where the unverified edge cases
  live. Deferred.
- **No location code at all, ever.** Rejected as too absolute: the foreground
  "nearest Job" clock-in *assist* is a real usability win the owner asked for, and
  it can be done without recording position. The line is drawn at "location may
  *assist* the act of clocking in, but is never recorded as evidence," not "no
  location code exists."
