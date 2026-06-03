# ADR 0005 — Shared and Personal phone numbers

Status: accepted, 2026-05-26

## Context

Nookleus is adding in-app communication with customers: two-way SMS,
two-way MMS, voice calls (inbound + outbound + voicemail with
transcription), and call recording. Today communication is happening
through CallRail (for marketing tracking) and through Crew Leads' own
personal cell phones (for one-on-one customer conversations), with no
record of any of it inside Nookleus.

We need to decide what a Phone number *is* in the domain model — who
owns it, who sees what flows through it, and how it interacts with the
Job and Contact entities — before we can write the schema, the RLS
policies, the UI, or the Twilio integration.

The natural reference point is ADR 0001 (Shared and Personal email
accounts), which faced the same question and chose a hybrid: Shared
accounts (Organization-wide, no individual owner, every email-permitted
member reads and sends) plus Personal accounts (owned by one User,
content-private to that User, admin can disconnect but cannot read).

Phone differs from email in one substantive way: **a Personal phone
number is paid for by the Organization, provisioned through the
Organization's Twilio account, and predominantly used for Job-related
work**. A Crew Lead's personal email account is plausibly *theirs*
(their professional identity outlives the company); a Crew Lead's
Nookleus-provisioned phone number is plausibly *the company's*. The
content-private-by-default rule that fits email doesn't obviously fit
phone — but a pure team-visible rule erases the only reason to have
Personal numbers at all.

## Decision

Phone numbers split into two kinds, **and content visibility is governed
by Job tag, not by number kind**:

- **Shared phone number** — what `team@`-style email is for email.
  Belongs to an Organization, no individual owner. Every member with
  the `view_phone` permission reads its incoming messages and sends
  from it; only an admin changes its settings, configures its inbound
  answer rule, or releases it. Schema: `user_id IS NULL`.
- **Personal phone number** — owned by exactly one User. Used for
  one-on-one relationship texting/calling with a customer so the
  customer can reach a specific Crew Lead rather than the company
  switchboard. Schema: `user_id = <owner>`.

Every text/call event carries an optional **Job tag** (set
automatically when unambiguous; manually otherwise — see the Phone
PRD's smart-attach rule). Content visibility flows from the tag, not
from the number kind:

| event | who can read it |
| --- | --- |
| Job-tagged event, on any number (Shared or Personal) | every member with `view_phone` who can see that Job |
| Untagged event on a Shared number | every member with `view_phone` in the Organization |
| Untagged event on a Personal number | the number's owner only |

Two surfaces fall out of this:

- The **Phone tab** in the nav is the per-user view of "messages on my
  numbers." A user sees their accessible Shared numbers' conversations
  and their own Personal number's conversations — including untagged
  content on their own Personal.
- The **Job card**'s Messages and Calls sections are the team view of
  "messages tagged to this Job." Every Job-tagged event surfaces
  there regardless of which number it happened on — Personal-number
  events included.

An admin can see in Settings → Phone that a User has a Personal
number and which number it is, and can **release** that number for
offboarding (the number goes back to the org's Twilio pool, can be
re-assigned to a new owner so the customer relationship survives, or
retired). An admin **cannot** read untagged Personal-number content.
Job-tagged content on a Personal number an admin already has Job
access to is visible to them via the Job — same as anyone else with
`view_phone`.

A single access-decision module is the only place that answers, for
a given (caller, event) pair, whether the caller can read it. The
User-client routes rely on RLS policies that encode this matrix; the
Service-client routes apply it in code.

### Alternatives considered

**Copy ADR 0001 exactly (Personal = blanket content-private).** Every
event on a Personal number is owner-only, including Job-related calls
and texts. Rejected because **Job content is company business** — when
Bob is on PTO and Eric needs to pick up Bob's customer's flood Job,
the customer's previous texts and recordings about that Job have to be
visible to Eric. Under the blanket-private rule they aren't, and Eric
has to either call Bob to ask or fly blind. Email gets away with the
blanket rule because email is less time-sensitive and less likely to
carry the only record of an agreement; phone is the opposite on both.

**Pure team-visible (Shared/Personal becomes just a default-number
distinction, not a privacy distinction).** Every event on every
number is visible to everyone with `view_phone`. Rejected because
the only reason to give Crew Leads a Personal number at all is for
**relationship-style customer contact** — and that includes occasional
genuinely non-company conversations (a wrong number, an old friend
who still has the work cell number, the Crew Lead's spouse texting
to grab milk on the way home). Under pure team-visible those land
in the team feed. The Crew Lead's response is to never use the
Personal number for anything that isn't strictly Job-tagged, which
defeats the point.

**Pure-shared (no Personal numbers, like the current state of email
before ADR 0001).** Rejected for the same reasons ADR 0001 rejected
it: every Crew Lead texts and calls customers from one switchboard
number, and the one-on-one relationship Crew Leads build with their
customers (the thing that drives repeat work in disaster recovery)
gets diluted into "you reached AAA Disaster Recovery."

### Why admin-can-release-but-not-read on Personal numbers

Same reason as ADR 0001: offboarding. When a Crew Lead leaves, their
Personal number cannot stay with their credentials forever. Someone
has to be able to release it, and that someone is the admin. The
admin needs to **see** the number exists; they do **not** need to
**read** its untagged content.

Job-tagged content on the Personal number is already team-visible —
admin can see it via the Job. The asymmetry is therefore narrower
than it is in ADR 0001: untagged Personal content is the only thing
hidden from admins.

### Why visibility is by Job tag, not by number kind

The first design pass mirrored ADR 0001 — Personal = content-private,
period. The user pushed back during the design discussion: "Calls and
texts that are specific to a job should be able to be seen across the
team." That distinction (Job vs not-Job) maps directly to how the
team thinks about communication — Job content is company business,
not-Job content might be anything — and it lets the same Personal
number carry both kinds of conversation without forcing the Crew Lead
to use a separate phone for personal calls.

The trust signal is the **tag**, not the number. The smart-attach rule
applies tags automatically when there's no ambiguity (an outbound
call started from the Job page, an inbound text from a Contact with
exactly one Active job); the user tags ambiguous events; untagged
events stay private.

### Why no new permission key beyond `view_phone`

`view_phone` is the direct analog of `view_email` and gates access
to the Phone feature surface. It defaults ON for Crew Lead and Admin,
OFF for Crew Member — same role defaults as email.

Number management (provisioning Shared numbers, releasing Personal
numbers) is gated on the admin role, not on a separate key. Same
reasoning as ADR 0001's "no new permission key" section: a new key
would either duplicate the admin role signal or, if granted to
non-admins, weaken the boundary the access matrix depends on.

## Consequences

**Positive**

- Crew Leads can connect a Nookleus-provisioned Personal number for
  one-on-one customer texting/calling without surrendering full content
  privacy (untagged conversations stay theirs) and without hiding Job
  work from teammates (Job-tagged conversations are team-visible).
- The team can pick up each other's Jobs without losing the customer's
  prior context — every Job-tagged text, call, voicemail, and
  recording is on the Job, regardless of which Crew Lead's number
  handled it.
- The Job card and the Phone tab tell two different stories with one
  underlying data model — the Job's slice (tagged events) is for the
  team; the Phone tab's slice (everything on numbers you have access
  to) is for the individual user.
- The privacy rule is captured once, in the phone-event-access module;
  every route, every RLS policy, and every UI surface delegates. The
  rule cannot drift across handlers.
- Offboarding is clean: the admin releases the departed Crew Lead's
  Personal number, re-assigns it to a new owner (preserving the
  customer's saved-number continuity), and never has to read content
  to do it.

**Negative**

- More subtle than ADR 0001's flat "Personal = private" rule. Two
  privacy stories live in the same product (email's and phone's),
  and they do not match each other. The phone rule has to be
  documented carefully — both in this ADR and in `CONTEXT.md`'s
  Conversation entry — because the natural reader assumption ("phone
  is like email") is now wrong.
- The smart-attach rule is now load-bearing for privacy, not just for
  Job-page convenience. If smart-attach incorrectly tags an untagged
  Personal conversation to a Job, the Crew Lead's private content
  leaks to the team via the Job. The attach rule's bias is therefore
  toward under-tagging: auto-tag only when there's exactly one Active
  job for the Contact; never guess.
- A future deviation (e.g. "admin can read Personal-number content for
  quality control") would require a new ADR — the access module's
  matrix is the source of truth and changes here are not silent.

**Out of scope (deliberately)**

- No re-classifying CallRail-era call records into Shared vs Personal.
  CallRail goes away (ADR 0006); existing CallRail call data is not
  migrated.
- No audit log of admin releases of Personal numbers. If compliance
  ever needs it, it's a follow-up.
- No ownership transfer of Personal numbers between users. An admin
  releases; the new owner re-claims the number under their own profile
  (the number stays the same, the owner changes, the customer's saved
  contact doesn't break).
- No team-level access to Personal numbers (e.g. "Crew Leads on the
  same team see each other's Personal threads"). The owner is the
  owner; teammates see only Job-tagged content via the Job.
