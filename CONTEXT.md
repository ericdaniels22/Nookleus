# Nookleus Platform Context

Nookleus is a multi-tenant SaaS for contracting businesses. Every server
request acts on behalf of one user working inside one company; the language
below names the pieces that make that scoping explicit and testable.

## Language

**Organization**:
A tenant — one contracting company. All business data (jobs, contracts,
estimates, invoices) belongs to exactly one Organization.
_Avoid_: tenant, account, company (in code — "company" is fine in UI copy)

**Active Organization**:
The single Organization a request is scoped to, resolved from the
`active_organization_id` claim on the user's access-token JWT. A user may
belong to several Organizations but acts within one at a time.
_Avoid_: current org, selected org

**Request Context**:
The bundle of facts about one authenticated server request — the user, their
Active Organization, their role in it, and a database client. Produced once
per request by the `withRequestContext` wrapper and handed to the route
handler, which never runs unless the request's permission rule passed.
_Avoid_: auth result, session, request scope

**User client**:
A database connection that acts as the logged-in user, with row-level
security enforced — the database itself prevents cross-Organization reads.
_Avoid_: server client, anon client

**Service client**:
A database connection with row-level security bypassed; it can reach every
Organization's data, so the caller is itself responsible for scoping by
Active Organization. Carried by a Request Context only when a route
explicitly opts in.
_Avoid_: admin client, master client

**Email account**:
A connection to an external mailbox (IMAP/SMTP) that Nookleus syncs and
sends mail through. Belongs to exactly one Organization. Comes in two kinds
— a Shared account or a Personal account.
_Avoid_: mailbox, inbox connection

**Shared email account**:
An Email account the whole Organization works from — e.g. a `team@` address
where job-related mail arrives. Every member with email access can read it
and send from it; only admins change its settings or disconnect it.
_Avoid_: company account, org inbox

**Personal email account**:
An Email account owned by one User and content-private to them — only the
owner reads its mail. An admin can see the account is connected and can
disconnect it (e.g. when the owner leaves the company) but cannot read its
messages.
_Avoid_: private inbox, user account

**Outgoing email**:
The per-document-kind configuration that decides, when Nookleus sends out
one of its document kinds (Invoice, Contract, Payment link, Estimate),
which Email account it leaves from and what the body of the email says.
Distinct from an Email account itself — an Email account is the mailbox;
an Outgoing email is the rule for using a mailbox to send a specific kind
of thing. The settings UI groups these together because they share a shape
(pick an account + edit a template) regardless of which document kind is
being sent.
_Avoid_: send config, mail rule, payment email / invoice email / contract email (use "Outgoing email for X")

**Phone number**:
A telephony endpoint (a single phone number provisioned through Nookleus's
telephony backbone — Twilio, see [ADR 0006](docs/adr/0006-twilio-as-telephony-backbone.md)) that Nookleus uses to send and receive
texts and voice calls on behalf of an Organization. Belongs to exactly one
Organization. Comes in two kinds — a Shared phone number or a Personal
phone number, parallel in shape to Email account / Shared email account /
Personal email account but with a different content-privacy rule (see
Conversation and [ADR 0005](docs/adr/0005-shared-and-personal-phone-numbers.md)).
_Avoid_: line, extension, DID

**Shared phone number**:
A Phone number the whole Organization works from — e.g. the main `(555)
555-COMPANY` line a Google/Yelp ad points to. Every member with phone
access can text/call from it and read its incoming messages; only admins
change its settings or release it.
_Avoid_: company line, main line, marketing number

**Personal phone number**:
A Phone number owned by exactly one User. Used for one-on-one
relationship texting/calling with a customer so the customer can reach a
specific Crew Lead rather than the company switchboard. Content visibility
is rule-bound (see Conversation) — not blanket-private like a Personal
email account, because Job-related content stays team-visible. An admin
can see the number exists and release it for offboarding, but cannot read
its untagged content.
_Avoid_: work cell, personal line, user number

**Conversation**:
The per-Contact threaded history of texts and voice calls between a
Nookleus user (or the company on its Shared line) and one outside phone
number. Threading is by Contact, iMessage-style — the same Contact across
multiple Jobs and over months stays one thread. Each individual message
or call inside a Conversation may carry a Job tag. The Phone-tab surface
shows Conversations; the Job-card surface shows the slice of Conversation
content tagged to that Job. Content visibility is governed by Job tag,
not by number kind — see [ADR 0005](docs/adr/0005-shared-and-personal-phone-numbers.md).
_Avoid_: chat, thread (in code — fine in UI copy), message log

**Job tag**:
The link from a single text/call event to a Job. Set automatically when
the event has no ambiguity (outbound started from a Job page; inbound
from a Contact with exactly one Active job) and prompted-for otherwise.
Untagged events live only in the Phone tab; tagged events also surface on
the Job's card. Visibility follows the tag: a Job-tagged event on a
Personal phone number is team-visible (because Job content is company
business), whereas an untagged event on the same Personal number is
owner-only — see [ADR 0005](docs/adr/0005-shared-and-personal-phone-numbers.md).
_Avoid_: job link, attribution, assignment

**Active job**:
A job that is still alive — its status is neither `completed` nor `cancelled`,
and it has not been trashed (`deleted_at IS NULL`). A cancelled job is dead,
not active. The dashboard's "Jobs to advance" and "People to respond to"
sections both filter to Active jobs only.
_Avoid_: open job, current job, running job, in-progress job (that one is a specific status, not the whole alive set)

**Target**:
A row on the Referral Partners call list whose Lifecycle status is still
Uncontacted (grey) or In progress (yellow) — i.e. someone we want to call
but who hasn't agreed to send us work yet. Same database row as a Referral
Partner; the name shifts based on Lifecycle status. The "Add Target" button
on the Referral Partners page creates one of these (always at status grey).
_Avoid_: lead, prospect, cold contact

**Referral Partner**:
A row on the Referral Partners call list whose Lifecycle status is Active
(green) — i.e. a company that has agreed to send us work, whether or not
they have actually sent a job yet. Same database row as a Target; the name
shifts the moment the row is flipped to Active. A row at Declined (red) is
an ex-Partner; the page title "Referral Partners" is used loosely to cover
all four statuses because the whole list is in service of producing
Referral Partners.
_Avoid_: referrer (in code — fine in UI copy), affiliate, source

**Lifecycle status**:
The four-state status that decides whether a row on the Referral Partners
call list is a Target or a Referral Partner: Uncontacted (grey), In
progress (yellow), Active (green), Declined (red). Every transition is a
deliberate user click — no automated promotions. Active is the only
status that makes the row a Referral Partner in the strict sense.
_Avoid_: stage, pipeline status, partner status

## Relationships

- A **User** belongs to one or more **Organizations**; each membership carries a role.
- A **Request Context** names exactly one **Active Organization**.
- A **Request Context** always carries a **User client**; it carries a **Service client** only when the route opts in.
- An **Email account** belongs to one **Organization**; a **Personal email account** is additionally owned by one **User**, a **Shared email account** by none.
- An **Outgoing email** belongs to one **Organization** and names exactly one **Email account** (the mailbox the document is sent from). There is one Outgoing email per document kind per Organization.
- A **Phone number** belongs to one **Organization**; a **Personal phone number** is additionally owned by one **User**, a **Shared phone number** by none.
- A **Conversation** is identified by the pair (one of the Organization's Phone numbers, one outside phone number) and groups its events on the Contact whose phone number matches the outside number.
- A **Job tag** ties one text or call event to exactly zero or one **Job**. A single Conversation may contain events with several different Job tags (or none).
- A row on the Referral Partners call list belongs to one **Organization** and is called either a **Target** or a **Referral Partner** depending on its **Lifecycle status** — same row, different name.
- A **Job** has zero or one referring **Referral Partner** (the Partner who sent the job our way). Only Active rows are eligible — see [ADR 0002](docs/adr/0002-only-active-partners-attach-to-jobs.md).

## Example dialogue

> **Dev:** "When a route asks for a Request Context, does it always get a Service client?"
> **Maintainer:** "No — only the User client by default. The Service client bypasses Organization scoping, so a route has to explicitly opt in, and that opt-in is visible right at the route's declaration."

## Flagged ambiguities

- "auth gate" was used for four near-identical route helpers (`requirePermission`, `requireAdmin`, `requireViewAccounting`, and an inline `requireLogExpenses`) — resolved: these collapse into the one **Request Context** wrapper.
- "active" was being used for two unrelated concepts in `src/lib/accounting/margins.ts`: (a) a job with financial activity in a reporting period, and (b) a non-completed job (the user-facing filter pill on the Job Profitability page, which also folds cancelled jobs in with active ones). Neither matches the canonical **Active job** definition above. The dashboard rebuild adopts the canonical meaning; the accounting page is left as-is for now but is a cleanup candidate.
