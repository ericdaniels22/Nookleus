# Nookleus Phone — demo / dev mode

PRD [#304](https://github.com/ericdaniels22/Nookleus/issues/304) (Nookleus Phone) is
gated in production on [#305](https://github.com/ericdaniels22/Nookleus/issues/305)
(A2P 10DLC carrier registration). PRD
[#368](https://github.com/ericdaniels22/Nookleus/issues/368) — slice 15 — adds a
**demo / dev mode** so the whole feature can run end-to-end with no carrier and no
Twilio account: a presenter can ship a deployed preview, a developer can run the
whole flow locally, and CI can exercise the real DB write paths.

This doc is the recipe. It tells you exactly which flags to flip, what runs for
real, and — more importantly — **what does not**.

## The two flags

Demo mode is the combination of **two orthogonal env vars**. You almost always
need both.

| Flag                              | Where it runs                                    | What it does                                                                                                                                            |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOOKLEUS_PHONE_DEMO_MODE`        | **Server-side**. Read at request time.           | Forks [`createTwilioClient()`](./twilio-client.ts) to return the in-process [fake provider](./fake-twilio-client.ts) instead of the real Twilio SDK, and unlocks the [`POST /api/phone/dev/simulate-inbound`](../../app/api/phone/dev/simulate-inbound/route.ts) route. |
| `NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED` | **Client bundle + server**. Inlined by Next at build time. | Enables the outbound SMS UI surface (the existing #309 gate, [`feature-flags.ts`](./feature-flags.ts)). Without it, the outbound compose UI stays hidden. |

The flags are orthogonal: each is meaningful on its own. A demo wants the
combination — `NOOKLEUS_PHONE_DEMO_MODE` alone gives you a fake provider behind
a hidden UI, and `NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED` alone tries to send real
SMS without A2P clearance.

## Recipe — local

In `.env.local`:

```bash
NOOKLEUS_PHONE_DEMO_MODE=true
NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED=true
```

Then `npm run dev`. You do **not** need `TWILIO_ACCOUNT_SID` or
`TWILIO_AUTH_TOKEN`.

To turn demo mode off, **unset `NOOKLEUS_PHONE_DEMO_MODE`** (one variable, one
edit) and restart the dev server. The factory will then require real Twilio
credentials, and the simulator route 404s.

## Recipe — deployed preview

Both vars must be present at **build time**, not just at request time. Set both
in the preview environment's build configuration (e.g. Vercel preview env vars)
and trigger a new build.

> ⚠️ **`NEXT_PUBLIC_*` is inlined into the client bundle at build time.** Flipping
> it at runtime after the build will not change the UI. If you change either
> flag, you need a **rebuild** (preview) or a **dev-server restart** (local).
> A runtime flip on the server alone will leave the client UI in its
> built-against state.

## Production safety

`createTwilioClient()` **throws** if `NOOKLEUS_PHONE_DEMO_MODE === 'true'` while
`NODE_ENV === 'production'`. The fake provider must never silently swallow a
real customer's SMS; this throw is the safety property. See
[`twilio-client.ts`](./twilio-client.ts).

## What runs for real

Everything except the two carrier hops. Demo mode does not stub out the
application — it stubs out the carrier.

- **Number selection** — the picker, the area-code search, and the provision
  call all flow through [`select-outbound-number.ts`](./select-outbound-number.ts)
  and the `phone_numbers` table for real. The fake provider returns
  synthetic-but-deterministic local numbers in the `+1<area>555-00XX` block so
  they can never collide with a real subscriber line.
- **TCPA opt-out** — STOP / HELP keyword classification, the org-wide opt-out
  registry insert, and the gate on outbound send all run unchanged. See
  [`opt-out-registry.ts`](./opt-out-registry.ts).
- **Smart-attach** — the routing decision tree
  ([`route-inbound.ts`](./route-inbound.ts) + [`smart-attach.ts`](./smart-attach.ts))
  runs on real Contacts and Active Jobs from the database.
- **Conversation threading** — the upsert by `(phone_number_id, outside_e164)`
  hits the real `phone_conversations` table; `unread_count` and `last_event_at`
  are bumped for real.
- **Job sections** — the Phone section on a Job View renders from the real
  `phone_messages` table.
- **RLS and the access matrix** — every read and write goes through the same
  Supabase RLS policies as production. Demo mode does not weaken auth.
- **Realtime push** — the [`use-phone-sync.ts`](./use-phone-sync.ts) hook is
  subscribed to real `postgres_changes` INSERT events, so a simulated inbound
  pushes into any open thread live.

The **only** moving parts the fake substitutes for are:

- **Outbound carrier send** — `client.messages.create()` returns a synthetic
  `SM…` SID with `status: 'queued'`. The carrier is never contacted.
- **Inbound carrier receive** — instead of a real Twilio webhook, you POST to
  [`/api/phone/dev/simulate-inbound`](../../app/api/phone/dev/simulate-inbound/route.ts)
  to inject an inbound text. The simulator delegates to the same
  [`ingestInbound()`](./ingest-inbound.ts) helper the real webhook uses, so the
  demo path cannot drift from real-inbound behavior.

## Explicit non-claims

These are things demo mode does **not** do. Calling them out so the demo isn't
oversold:

- **No live delivery-status badges.** The fake's `messages.create` returns
  `status: 'queued'` and that's it. There is no follow-up status callback. More
  fundamentally, the UI doesn't render delivery-status badges at all, and the
  realtime subscription
  ([`use-phone-sync.ts`](./use-phone-sync.ts), `event: 'INSERT'`) is
  **INSERT-only** — no UPDATE events would propagate even if the row were
  patched later. A "Delivered ✓✓" demo is not on the table here.
- **The demo reaches no carrier.** No SMS leaves the Node process. No phone
  number is ever charged. The fake's number-picker results are synthetic, not
  reservations on Twilio's inventory.
- **MMS send is provider-supported, not a demo story.** The fake's
  `messages.create` does accept `mediaUrl`, so the provider contract supports
  MMS — but a true end-to-end MMS-send demo is gated on
  [#310](https://github.com/ericdaniels22/Nookleus/issues/310) (the outbound
  send UI / route, currently unbuilt). PRD #368 user story 8 is
  **provider-supported**, not a full send demo here.

## Ongoing tooling, not throwaway

The fake provider and the inbound simulator are intended **ongoing local-dev /
CI tooling** after launch. They are how a developer exercises the Phone feature
without burning real SMS, and how CI tests can drive the inbound path
deterministically. Do not delete them when #305 clears.
