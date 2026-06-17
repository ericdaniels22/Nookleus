# New-intake push notifications: client-triggered send, direct to APNs

**Status:** accepted (2026-06-15)

When a member submits the **New Customer Intake** form, the rest of the team is
notified on their iPhones that a new Job came in. Two shape decisions are worth
recording because a future reader would otherwise assume the opposite.

## Decision

- The notification is **fired from the client.** After the intake form's existing
  client-side Job insert succeeds, it calls a server route that fans out the in-app
  **notification** rows and sends the push. We did *not* put a database trigger on
  `jobs` insert.
- Push is sent **directly to Apple (APNs)** from our own server using one APNs auth
  key — no Firebase/OneSignal middleman, no edge function.
- Audience is every active member of the **Organization** except the submitter.
  Delivery rides Capacitor's push plugin on the iOS app only: web/desktop sessions
  and devices that never enrolled get the in-app bell, not a buzz. The buzz's title
  and sound vary by the Job's **Urgency** (`emergency` / `urgent` / `scheduled`).

## Considered options

- **Database trigger → edge function** (guaranteed, server-authoritative). Rejected
  for v1: it needs a new `created_via` discriminator on `jobs` (there is none — a raw
  insert trigger can't tell an intake from any other Job insert), the repo's
  first-ever Supabase edge function, `pg_net`, and APNs creds in the edge runtime.
  Too much new machinery for the first slice.
- **Move Job creation server-side** (transactional notify). Rejected for v1: it means
  rebuilding a working multi-insert client form for no user-visible gain yet.
- **Firebase / OneSignal** (helper service). Rejected: the team is iPhone-only and
  internal, so the dashboards and easy-Android reach a service buys aren't worth a
  third party in the data path and an extra SDK in the app.

## Consequences

- The send is **best-effort.** If the submitter's client dies between the Job insert
  and the server call, that Job is still saved (and visible in the jobs list) but no
  buzz or bell is emitted for it. Acceptable while intakes are low-volume and
  internal; revisit with the DB-trigger option if a missed buzz ever costs a lead.
- We now hold an APNs auth key as a server secret and a `device_tokens` table (one
  row per member per device) that must be refreshed and pruned as Apple invalidates
  tokens.
- "Critical Alerts" (break-through-silent-mode), per-person opt-out, and a per-person
  sound picker are deliberately **out of v1** — see the feature's PRD. Sounds still
  differ by Urgency tier.
