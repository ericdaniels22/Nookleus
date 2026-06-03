# ADR 0006 — Twilio as Nookleus's telephony backbone

Status: accepted, 2026-05-26

## Context

The Phone feature (ADR 0005) requires a telephony vendor to provide
the actual pipes: provision and own phone numbers, deliver SMS and
MMS, route inbound voice calls, place outbound voice calls (via
bridge first, then in-browser softphone, then native iOS via
CallKit), record calls with the legally-required consent notice,
take voicemail with automatic transcription, and handle A2P 10DLC
registration for US business SMS.

Today, Nookleus uses CallRail for marketing call tracking, and crew
communication happens on individual cell phones outside the
application. There is no programmable backbone in place.

The vendor choice is architectural lock-in. The schema, the access
module from ADR 0005, the webhook handlers, the SDKs in the iOS
app and the future browser softphone — all of it is shaped by the
vendor's API. Swapping vendors after the feature ships would mean
porting numbers (a 2–3 week per-number process with carrier paperwork)
and rewriting the integration surface end-to-end. The decision is
deliberately scoped here so a future reader doesn't have to
re-derive it from the code.

## Decision

Twilio is Nookleus's telephony backbone.

We use the following Twilio surfaces:

- **Programmable Messaging** for SMS and MMS, including A2P 10DLC
  brand + campaign registration.
- **Programmable Voice** with TwiML for inbound routing (ring-all /
  round-robin / forward / voicemail per-number), outbound bridge
  calling (the Layer 1 call mechanism), and recording with the
  beep + spoken consent notice played at the start of every
  recorded call.
- **Voice JS SDK** for the Layer 2 in-browser softphone.
- **Voice iOS SDK** + CallKit + PushKit for the Layer 2 native iOS
  calling experience on the Nookleus iPhone app.
- **Voice Intelligence** (or equivalent) for voicemail transcription.
- **Conversations API** as the unified threading primitive — one
  Twilio Conversation per (Nookleus phone number, outside phone
  number) pair, mapped to Nookleus's Conversation entity on the
  Contact whose phone matches the outside number.

Twilio owns the numbers, the carrier relationships, and the A2P
registration. Nookleus owns the UI, the privacy rules (ADR 0005), the
Job-tag attachment logic, the permission model, and the data of record
(every message and call event is persisted in Nookleus's database;
Twilio is the transport, not the source of truth).

### Alternatives considered

**CallRail (existing vendor).** Rejected. CallRail is a marketing
call-tracking product first and a communication product second. Its
SMS is functional but spartan (limited MMS, weak group messaging);
its Voice product has no in-browser SDK and no CallKit-grade iOS
SDK, so the Layer 2 milestones are unreachable without bringing in
a second vendor anyway. Building a "communicate from inside the
app" feature on a tracking-first vendor's API is structurally wrong.
ADR 0005's tag-based privacy model and the Conversations API
mapping it relies on have no equivalent in CallRail.

The user already pays for CallRail. The marketing-attribution use
case CallRail does well (which marketing source rang the phone)
was set aside during the design discussion — it can return as a
separate later integration if the team ever misses it. Existing
CallRail numbers port to Twilio with the Phone feature launch.

**OpenPhone (their app + their API).** Rejected. OpenPhone is a
polished phone application with a public API that lets external
systems log conversations against records — it is built for "log
into our app, talk to customers there, sync the data elsewhere."
Nookleus's goal is the opposite: be the app the user opens to
talk to customers. OpenPhone has no programmable Voice SDK for
browser or iOS, so the Layer 2 in-app calling milestones are
impossible without abandoning OpenPhone. Their recording is theirs,
not ours. Using OpenPhone would mean the team uses two apps
forever, which defeats the goal.

**Plivo / Bandwidth / Telnyx (Twilio-shaped alternatives).** Not
rejected for capability — these vendors can do most of what Twilio
can do, often at lower per-unit cost. Rejected for ecosystem and
maturity: Twilio's documentation, SDK quality (especially Voice JS
and Voice iOS), A2P 10DLC tooling, and the Conversations API are
ahead of the alternatives by enough that the cost difference is not
worth the integration friction for a team this size. If volume ever
makes the cost gap material, the Conversations-API-shaped data model
makes migrating to a Twilio-shaped competitor tractable (not free —
the SDKs would need swapping — but the data shape doesn't change).

**RingCentral / Aircall / Dialpad / JustCall (turnkey business
phone vendors).** Rejected for the same reason as OpenPhone: their
APIs are integration surfaces around their own phone applications,
not programmable telephony primitives. They optimize for "use our
app and sync events outward"; we want "build our own UI and use the
vendor as transport."

**Hybrid (Twilio for communication + CallRail for attribution).**
Considered. Rejected for this PRD because the user explicitly chose
the full migration path during the design discussion. The hybrid
remains viable as a later add-on if the team decides marketing
attribution is worth a separate integration — the Phone feature's
data shape doesn't preclude wiring CallRail back in alongside
Twilio. Out of scope here.

## Consequences

**Positive**

- Every Phone feature on the three-layer roadmap (bridge calling,
  in-browser softphone, native iOS via CallKit, MMS, voicemail
  transcription, recording, Conversations threading, A2P 10DLC) is a
  first-class Twilio API. We never have to migrate to ship the next
  layer.
- The Conversations API gives us a natural mapping for ADR 0005's
  per-Contact threading — one Twilio Conversation per
  (Nookleus number, outside number) pair, with every message and
  call event hung off it.
- Twilio's A2P 10DLC tooling handles the messiest part of US business
  SMS compliance (brand + campaign registration with The Campaign
  Registry, carrier surcharges, throughput tiers). We do the
  paperwork once.
- One vendor, one contract, one set of webhooks, one set of SDKs.

**Negative**

- Pay-as-you-go pricing means a heavy-use month is more expensive
  than a flat-rate competitor. Per-message and per-minute costs need
  to be modeled so Organization billing (or per-number pricing
  passed to customers) makes sense. Not a Day-1 problem; becomes one
  once Phone usage grows.
- The Twilio API surface is large. Discipline is needed about which
  corners we use: Programmable Messaging + Programmable Voice +
  Conversations + the Voice SDKs are in; Studio Flows, Flex,
  Frontline, and other higher-level Twilio products are out (using
  them would re-introduce the "use our app" problem we rejected
  OpenPhone for).
- Lock-in is real. Replacing Twilio after launch means porting every
  number (carrier paperwork, ~2–3 weeks per batch) and rewriting
  every integration surface. The data shape (per-Contact
  Conversations + tagged events) is deliberately vendor-shaped to
  avoid this risk, but the SDKs aren't portable.

**Out of scope (deliberately)**

- No use of Twilio Studio, Flex, or Frontline. The UI is Nookleus's.
- No use of Twilio's hosted contact-center features. The team is
  small; routing rules in TwiML are enough.
- No multi-vendor abstraction layer over Twilio. Premature; would
  cost real engineering time to defend against a swap that may
  never happen. ADR-level data shape discipline is enough.
- No marketing attribution integration. CallRail goes away with this
  launch; if attribution returns it gets its own ADR.
