# ADR 0001 — Shared and Personal email accounts

Status: accepted, 2026-05-20

## Context

Today every Email account in Nookleus is Organization-wide: a single
`email_accounts` row carries no individual owner, and every member of the
Organization who holds `view_email` reads and sends from it. The intent
was that companies would connect a shared address — something like
`team@aaadisasterrecovery.com` — and route job-related mail through it.

In practice this model has broken down in two ways:

1. **Admins are forced to connect their own personal inbox at the
   Organization level just to use the email feature**, because no other
   address exists yet. Every Crew Lead then sees the admin's personal mail.
2. **There is no path for a Crew Lead to connect their own work email
   privately.** Any account they add becomes visible to everyone in the
   Organization who holds `view_email`, including their colleagues.

Separately, during the investigation that produced this ADR we found that
PRD #134's parent investigation surfaced a class of crew accounts that
need their own private inbox (an estimator's customer correspondence,
a crew lead's coordination thread with subs) where the shared-by-default
model is wrong. We have to decide what the domain model is before we can
write the access rules, the schema, or the UI.

The repo's domain language for this area is captured in `CONTEXT.md`:
**Email account**, **Shared email account**, **Personal email account**.
This ADR commits to those terms.

## Decision

Email accounts split into two kinds:

- **Shared email account** — what every account is today. Belongs to an
  Organization, no individual owner. Every member with email access reads
  and sends from it; only an admin changes its settings or disconnects it.
  Schema: `user_id IS NULL`. Used for addresses like `team@…` where
  job-related mail arrives.
- **Personal email account** — owned by exactly one User and
  **content-private** to that User. Only the owner reads its mail. An
  admin can see the account is connected and can disconnect it (for
  example when the owner leaves the company) but cannot read its
  messages. Schema: `user_id = <owner>`.

A Crew Lead working in the app sees the Organization's Shared accounts
and their own Personal account(s) in the email feature, and nothing
else. An admin sees the same in the email feature, plus a management
view in Settings → Email that lists every account in the Organization
with its owner label — but the admin still cannot read mail on a
Personal account they do not own.

A single access-decision module is the only place that answers, for a
given (caller, account) pair, the three questions every route needs:

| account kind | caller is admin (own org) | caller is owner | caller is other-org member with email perm | caller is in a different org |
| --- | --- | --- | --- | --- |
| Shared       | see + read + manage | n/a                  | see + read (no manage) | all false |
| Personal     | see + manage (no read) | see + read + manage | all false               | all false |

The Service-client routes apply this matrix in code because they bypass
row-level security; the User-client routes rely on RLS policies that
encode the same matrix.

### Alternatives considered

**Pure-shared (status quo).** Every account is Organization-wide; no
`user_id` column; visibility governed by `view_email`. Rejected because
it is the problem we are here to fix: the admin's personal inbox leaks
to every Crew Lead the moment the feature is turned on, and there is no
way to give a Crew Lead a private work mailbox without exposing it to
the rest of the company.

**Pure-private.** Every account is owned by exactly one User; no Shared
kind exists; companies that want a `team@` address pool messages by some
other mechanism (forwarding, multi-account inboxes). Rejected because
the `team@` use case is real and load-bearing — job-related mail that
multiple crew need to see has to live somewhere visible to all of them,
and pushing that out of Nookleus defeats the email feature. Pure-private
also leaves admins with no offboarding path for a departing crew
member's account: the credentials would either stay live forever or
require the departing user to disconnect them on their way out.

**Pure-private with admin-can-read.** Same as pure-private, but admins
can read any account in their Organization. Rejected because it defeats
the content-privacy point: a Crew Lead who connects their own work email
under the promise of privacy has effectively no privacy from their
admin, and the feature stops being meaningfully different from the
pure-shared status quo.

### Why admin-management of Personal accounts is content-private, not fully invisible

A simpler private model would hide Personal accounts entirely from
admins — make them indistinguishable from non-existence. We chose not
to. The constraint that forced the hybrid is **offboarding**: when a
Crew Lead leaves the company, their Personal account credentials cannot
sit in the system forever. Someone has to be able to disconnect it,
and that someone is the admin. So the admin needs to see the account
exists and have the ability to remove it.

What they do not need, and must not have, is the ability to **read** its
mail. The access module enforces this asymmetry directly: admin reads
of a Personal account return as if the account were absent; admin
disconnects succeed. The boundary lives in code, not in trust.

### Why no new permission key

A natural shape would be to introduce a `manage_email_accounts` or
`admin_email` key in `PERMISSION_CATALOG` and gate Shared-account
management on it. We chose not to:

- The rule we actually want is *the admin role can manage Shared
  accounts*, and Nookleus already has a first-class concept of admin
  role membership. A new permission key would either duplicate that
  signal or, if granted to non-admins, weaken the boundary the access
  matrix depends on.
- Adding a key means a `settings/users` seed migration so existing
  admins get it by default, plus a new row in the permission management
  UI. None of that buys clarity over checking the role inside the
  access module.

The rule lives in the access module, keyed off the caller's role in
their Active Organization. Role defaults are unchanged: Crew Members
still have no email permission; only Crew Leads and Admins do.

### Why a wipe-the-slate migration is acceptable

The migration that introduces `user_id` and the new RLS policies wipes
every row in `email_accounts` first; `ON DELETE CASCADE` clears
`emails` and `email_attachments`.

This is acceptable because:

- **No real customers on Nookleus prod yet** (`project_no_real_customers_yet`),
  so there is no production data to preserve.
- The user has confirmed in the design discussion that email is not yet
  heavily used. Re-classifying existing rows into Shared vs. Personal
  would require admin judgement on every row (which is the personal
  inbox, which is the `team@`?), and getting it wrong would either leak
  mail or hide it. A clean re-connect under the new model is more
  reliable.
- The two `team@`-style addresses and the personal inboxes currently
  connected can be re-added under the new kinds in minutes.

## Consequences

**Positive**

- Crew Leads can connect their own work email and trust that no
  colleague — including their admin — reads it.
- Admins can still run the company-wide `team@` mailbox the way they
  do today, and can offboard a departing Crew Lead's Personal account
  without depending on the departing user.
- The access matrix is captured once, in the email-account-access
  module; every route delegates. The rule cannot drift across half a
  dozen handlers.
- The domain language (Shared / Personal) matches `CONTEXT.md` and the
  PRD, so future readers do not have to re-derive the model from the
  code.

**Negative**

- The hybrid is slightly more complex than either pure model. Three
  questions instead of one (`canSee` / `canRead` / `canManage`), and a
  matrix that varies by account kind and caller role.
- "Content-private but admin can disconnect" requires the access module
  to be the single source of truth — any future route that touches
  `email_accounts`, `emails`, or `email_attachments` outside the module
  is a potential leak. Code review for new email-area routes has to
  flag direct database access as a smell.
- The wipe-the-slate migration is a one-time mess. It is acceptable now
  because no real customers are on prod; it would not be acceptable
  later, so the schema design and RLS policies need to be right the
  first time.

**Out of scope (deliberately)**

- No new permission keys.
- No change to role defaults.
- No login-email editor (the misbuilt feature that triggered this PRD's
  investigation is rolled back by PRD #134's first slice).
- No ownership transfer of Personal accounts. An admin can disconnect;
  the new owner re-connects under their own credentials.
- No re-sync of historical mail after the wipe.
- No audit log of admin disconnects of Personal accounts. If compliance
  ever needs it, it is a follow-up.
