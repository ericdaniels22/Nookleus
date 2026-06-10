# Runbook — A2P 10DLC brand + campaign registration (#305)

> **This is paperwork, not engineering.** It is the longest-lead-time item in
> PRD [#304](https://github.com/ericdaniels22/Nookleus/issues/304) — carrier
> review runs **1–3 weeks** — and no outbound SMS reaches a real US handset at
> scale until it clears. Start the day the issue is grabbed.
>
> The **code** that consumes this work is already merged and waiting behind a
> flag (see [Code wiring](#code-wiring-already-in-place)). This document is the
> recipe for the **carrier-side** steps a human runs in the Twilio Console +
> The Campaign Registry (TCR), which no agent can do.

## Why outbound SMS is gated on this

US mobile carriers (AT&T, Verizon, T-Mobile, …) filter **A2P** (application-to-
person) traffic at the gateway. Business SMS from an unregistered sender is
silently dropped or heavily throttled. To deliver, the message must be sent
through a **Twilio Messaging Service** that is bound to an **A2P campaign**
registered with **TCR** under a **vetted brand**. That chain — brand → campaign
→ messaging service → our sending numbers — is what this runbook builds.

## The chain to build

```
AAA Disaster Recovery (legal entity)
   └─ Brand          (TCR-vetted, Standard tier or higher)
        └─ Campaign   (use-case: Customer Care)
             └─ Messaging Service   (TWILIO_MESSAGING_SERVICE_SID)
                  └─ sender pool: the org's outbound phone_numbers
```

---

## Step 1 — Register the brand

Twilio Console → **Messaging → Regulatory Compliance → A2P 10DLC → Brands**.
Register under **AAA Disaster Recovery**'s legal entity (AAA is the prototype
customer for the multi-tenant build, per the PRD).

Fill from AAA's official records — these must match the IRS/Secretary-of-State
filing exactly or vetting fails:

| Field | Value |
| --- | --- |
| Legal company name | `AAA Disaster Recovery` _(confirm exact registered name)_ |
| EIN / Tax ID | `__________` _(AAA's federal EIN — required)_ |
| Business type | _(LLC / Corp / Sole-prop — per filing)_ |
| Registered address | `__________` |
| Website | `__________` |
| Contact email / phone | `__________` |

Submit for vetting. **Target: Standard tier or higher** (AC). Standard-tier
vetting unlocks materially higher throughput than the unvetted/low tiers.

- [ ] Brand submitted with EIN, legal name, address
- [ ] Brand passes vetting at **Standard tier or higher**

---

## Step 2 — Register the campaign (use-case: Customer Care)

Twilio Console → **A2P 10DLC → Campaigns** → new campaign under the vetted brand.

**Use-case: `Customer Care`** — transactional + relationship messaging with
**consenting customers**: quotes, job-status updates, photo replies, and
voicemail-from-Nookleus notifications.

### Campaign description (draft — tighten to AAA's reality)

> Nookleus is the field-operations app AAA Disaster Recovery uses to
> communicate with its own customers about active jobs. Messages are sent by
> AAA staff to customers who have an existing service relationship: estimate /
> quote delivery, job-status updates, replies that include job-site photos, and
> notifications that a voicemail was left. Customers reply in the same thread.

### Consent / opt-in (Customer Care)

Describe how consent is captured. Customers are existing AAA service contacts;
the first message is staff-initiated within an active service relationship, not
bulk marketing. **Document the real opt-in mechanism** (intake form, signed
work authorization, verbal-at-intake, etc.) — TCR requires a truthful opt-in
description, and this is AAA-specific information the runbook can't fill in.

- [ ] Opt-in flow described truthfully for AAA's intake

### Opt-out / HELP behavior — declare what the app actually does

These are the behaviors the carrier campaign description must match. Note the
two have different gating in code:

- **STOP** (and `UNSUBSCRIBE / END / QUIT / CANCEL / STOPALL`) → **unconditional
  today.** The sender is added to the org-wide opt-out registry and **all**
  further outbound to that number is refused. The app sends **no** auto-reply
  on STOP — Twilio emits the carrier-mandated opt-out confirmation. (See
  `opt-out-registry.ts`, `ingest-inbound.ts` — runs before any flag check.)
- **HELP / INFO** → the app auto-replies, **but only once outbound is enabled**
  (`ingest-inbound.ts` gates it on `isPhoneOutboundEnabled()` — the same
  `NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED` flag Step 4 flips). Until then no HELP
  reply is sent. At go-live it replies with, verbatim:

  > `<Org name>: Reply STOP to unsubscribe. Standard message rates apply.`

  (`ingest-inbound.ts` — `helpReplyBody`.)

### Sample message bodies — must match what slices 5/6 actually send

Paste representative samples that mirror real sends (quotes, status, photo-MMS,
voicemail notice, and the HELP reply). Suggested set:

1. `AAA Disaster Recovery: your quote for the water-damage cleanup is ready — reply here with any questions.`
2. `Update on your job: our crew is scheduled to arrive tomorrow between 9–11am. Reply STOP to unsubscribe.`
3. `Here are photos from today's work at your property.` _(MMS — slice 6 / #310, image attached)_
4. `You have a new voicemail from AAA Disaster Recovery. Open the Nookleus thread to listen.`
5. `AAA Disaster Recovery: Reply STOP to unsubscribe. Standard message rates apply.` _(HELP auto-reply, verbatim)_

> Keep at least one sample showing the **opt-out language** (`Reply STOP …`) —
> reviewers look for it. Samples should read like the free-text a Crew Lead
> actually types from the compose box, not marketing copy.

- [ ] Campaign registered under **Customer Care** with sample bodies matching slices 5/6
- [ ] Campaign **approved by TCR**

---

## Step 3 — Messaging Service + capture the SID

Twilio Console → **Messaging → Services**.

1. Create (or identify) a **Messaging Service** and **attach the approved
   campaign** to it.
2. Add the org's outbound number(s) — the rows in `phone_numbers` Nookleus
   sends from — to the Service's **sender pool**. The send keeps its specific
   `from` number (Nookleus selects Personal-if-any-else-Shared), and Twilio
   requires that `from` be in the Service's pool, so **every number Nookleus
   sends from must be added here.**
3. Copy the Service SID (`MG…`).

### Set the env var

Set in the deployment environment (e.g. Vercel) **and** `.env.local` for any
local real-carrier testing:

```bash
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

When set, `POST /api/phone/messages` sends through the Service so carriers
associate each message with the approved campaign. When blank, the send is a
bare per-number dispatch (correct for demo/dev; **not** deliverable at scale).
This is a plain server-side env var (not `NEXT_PUBLIC_`), so a runtime change +
restart is enough — no rebuild required.

- [ ] Messaging Service created and bound to the approved campaign
- [ ] Org's outbound number(s) added to the Service's sender pool
- [ ] `TWILIO_MESSAGING_SERVICE_SID` set in environment config

---

## Step 4 — Flip outbound on

Outbound SMS is *also* behind the slice-5 feature flag
(`NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED`, see
[`src/lib/phone/feature-flags.ts`](../../src/lib/phone/feature-flags.ts) and
[`src/lib/phone/README.md`](../../src/lib/phone/README.md)). The two are
independent:

| Var | Effect | Change requires |
| --- | --- | --- |
| `TWILIO_MESSAGING_SERVICE_SID` | A2P campaign association on send | restart |
| `NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED=true` | Reveals the outbound UI + lifts the route's 503 gate | **rebuild** (inlined into the client bundle at build time) |

The day the campaign clears: set **both**, redeploy, and outbound is live and
deliverable.

- [ ] `NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED=true` set and redeployed

---

## Step 5 — Document the outcome on #305 (AC)

Post a final comment on issue #305 recording, for future-us:

- **Approval date** of the campaign.
- **Per-month / per-day throughput tier** granted (the T-tier message limits the
  brand/campaign was approved for — this is what we're rate-limited to).
- The **Messaging Service SID** (or where it's stored).

- [ ] Approval date + throughput tier documented in #305's final comment

---

## Code wiring already in place

Future-us: the application side is **done and tested** — only the carrier steps
above remain. Nothing else needs to change in code to go live.

- [`src/lib/phone/twilio-client.ts`](../../src/lib/phone/twilio-client.ts) —
  `sendSms` forwards `messagingServiceSid` to Twilio when supplied, keeping
  `from` for deterministic sender selection (the A2P "dual form").
- [`src/app/api/phone/messages/route.ts`](../../src/app/api/phone/messages/route.ts) —
  reads `TWILIO_MESSAGING_SERVICE_SID` and threads it into every send.
- [`src/lib/phone/feature-flags.ts`](../../src/lib/phone/feature-flags.ts) —
  the `NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED` gate.
- Tests: `twilio-client.test.ts` (forwarding + dual form),
  `messages/route.test.ts` (env threaded in when set, omitted when unset).

## Related

- ADR [0006](../adr/0006-twilio-as-telephony-backbone.md) — Twilio as the telephony backbone.
- ADR [0005](../adr/0005-shared-and-personal-phone-numbers.md) — Shared vs Personal numbers (the `from` selection rule).
- PRD [#304](https://github.com/ericdaniels22/Nookleus/issues/304); slices #309 (outbound SMS), #310 (MMS), #368 (demo mode).
