# The device tap instant is authoritative for a Time session's times; the server-received time is audit-only

**Status:** Accepted
**Date:** 2026-06-19 (issue #702 — offline-resilient clock-in & self-nudges, parent epic #699)

A **Time session**'s **Clock in** / **Clock out** times are the worker's
**device** tap instant, captured on the device at the moment of the tap. The
time the server *received* the tap is stored separately as audit-only metadata
and is never substituted for the recorded time. This narrows slice 1's "never
trust a client clock" stance and is worth recording because, read carelessly, it
looks like it contradicts both that stance and [ADR 0020](0020-labor-hour-classification-and-org-timezone.md).

## Context

Slice 1 (issue #701) recorded a session's times by stamping `new Date()` on the
**server** when the clock-in / clock-out request arrived, with the explicit
comment *"never trust a client clock."* That is fine while the tap and the
request are simultaneous — but issue #702 makes the clock survive being tapped
**offline**. An offline tap is enqueued on the device and may not reach the
server for minutes or hours, or until after an app restart. If the server kept
stamping the receive time, every offline session would be silently shifted to
whenever the network came back — wrong hours, and worst exactly when a worker's
connection is flaky. So for the offline path the recorded instant **must** be
the device's, captured at the tap (`taken_at`).

The tension to resolve: ADR 0020 says hours are classified *"against the
Organization timezone, never the recording device's clock,"* and slice 1 said
*"never trust a client clock."* Taken literally these forbid what #702 requires.
They do not actually conflict — but only once the distinction between the *frame*
and the *instant* is made explicit.

## Decision

1. **The device `taken_at` is the session time.** `started_at` (clock-in) and
   `ended_at` (clock-out) are always the worker's device tap instant — a single
   point on the UTC timeline — online or offline. The Route Handler honors a
   client-supplied `takenAt`; only a direct **online** tap that omits one falls
   back to a server stamp.
2. **Server-received time is audit-only.** The instant the server received the
   tap is stored as a separate column (`server_received_at`) and **never**
   substitutes for `taken_at`. It exists only so the gap between "tapped" and
   "reached the server" is observable for a late offline sync; it never moves the
   recorded hours.
3. **This does not weaken ADR 0020.** ADR 0020 governs the **frame** hours are
   classified in — Regular / Premium, day boundaries, the >8h cap — always the
   one **Organization timezone**, server-side. This ADR governs the **instant** a
   session starts and ends — the device's tap. An instant is a timezone-free
   point; the classification frame is applied to it afterward. The whole rule is:
   *trust the device for the instant, never for the classification frame.* Slice
   1's "never trust a client clock" is narrowed to its real meaning — never let
   the device decide the **classification** — which still holds.
4. **Still no location (ADR 0019).** Trusting the device for the *instant* does
   not mean trusting it for *place*. The tap carries time only — no lat / long /
   geofence / coordinate of any kind, in the payload or the stored session.

## Consequences

- A worker — or a tampered device — can in principle report a `taken_at` that is
  not the true tap time. This is **accepted**: a crew member can already mis-tap
  or request a **Correction**, the hours are visible to leads on the **Job
  timesheet**, and an honest offline-first clock is impossible without trusting
  the device instant. `server_received_at` gives a reviewer the receive-vs-tap
  gap, which makes an implausibly old sync visible.
- The offline path needs an idempotency key (`client_capture_id`) so a replayed
  tap does not open a second session. That conflict-resolution machinery — the
  partial unique index on `(organization_id, client_capture_id)` and the
  idempotent `clock_in_to_job` / `clock_out_session` RPCs — lives in
  `supabase/migration-663-offline-clock.sql`.
- Times are still **never auto-fabricated** and the app **never** auto-clocks-out
  or back-dates an **Open session** (ADR 0019; #702 AC8). Honoring a real device
  tap is the opposite of inventing a time — a self-nudge only *reminds*, it never
  writes a time.
- A queued **Clock out** names the **original** session it was tapped for, so a
  late sync closes *that* session even if the worker has since clocked into a
  different Job. It must not be re-pointed at the current **Open session**.

## Considered options

- **Keep stamping the server-received time (slice 1's rule).** Rejected: it
  silently back-dates every offline session to network-return time, which defeats
  the entire offline feature — and fails worst precisely when connectivity is
  poor.
- **Trust the device instant only when "offline," server-stamp when "online."**
  Rejected: whether the device was online *at tap time* is not knowable at the
  server (only when the request arrives), and it would make two taps a few seconds
  apart record under different rules. One rule — honor `takenAt` when present — is
  simpler and correct.
- **Store only `taken_at`, drop `server_received_at`.** Rejected: the receive
  time is a cheap, useful audit signal for spotting a stale or replayed sync. It
  costs one nullable column and is never shown as the worked time.
- **Sign or server-validate the device clock.** Rejected for v1 as machinery
  without a stated threat: the trust model already lets crew self-clock, and leads
  review the hours. Revisit only if device-time abuse is ever actually observed.
