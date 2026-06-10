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

**Photo**:
A single image — or short video — captured on a Job and shown in the Job's
Photos tab. Belongs to exactly one Job. Distinct from a **File**: the Job's
Files tab holds documents/attachments, which are a separate feature. When
someone refers loosely to "the job's file" of pictures, they mean Photos.
_Avoid_: image, attachment, media; "file" (that's the separate documents feature)

**Photo Report**:
A document an Organization generates from a Job's Photos — Sections of
write-up plus the photos that evidence them — and exports as a PDF to hand
an adjuster or property owner. Belongs to exactly one Job. Created and
edited only from inside the Job: a report is started from the Job's Photos
tab (select photos → Create report) and its existing reports are listed and
reopened from the Job's Overview tab. There is no standalone reports area.
_Avoid_: report (ambiguous — there is also the accounting/profitability report), photo log, gallery

**Section** (of a Photo Report):
One unit of a Photo Report: a heading, a rich-text write-up (paragraphs and
bullet/numbered lists), and the Photos that illustrate it. Renders as an
optional **Section Title Page** (heading + write-up) followed by its **Photo
Pages**; the write-up is capped to a length set by the report's
photos-per-page choice. Distinct from an **Estimate** Section, which is a
group of priced line items — the two share only the word and no code.
_Avoid_: chapter, page, group

**Cover Page** (of a Photo Report):
The first page of a Photo Report — its title, an optional lead Photo (the
cover photo), and identifying blocks drawn from the Job and Organization
(logo, customer, property address, point of contact, insurance). Each report
owns its Cover Page: the title is editable, the cover photo is chosen per
report, and any block can be hidden. Previously every report's cover was
fixed and derived wholesale from the Job; it is now a per-report surface (see
[ADR 0014](docs/adr/0014-photo-reports-carry-per-report-cover-and-layout.md)).
_Avoid_: title page, front page, splash

**Section Title Page** (of a Photo Report):
The full page that carries one Section's heading and its write-up, printed
ahead of that Section's Photo Pages. Optional per report: when a report's
Report Settings switch Section Title Pages off, the write-up is left out of
the PDF and the Section is named only by the footer running along its Photo
Pages. The code calls this `section-divider-page`.
_Avoid_: section divider, intro page, summary page

**Photo Page** (of a Photo Report):
A page that lays out a Section's Photos — 2, 3, or 4 to a page per the
report's Report Settings — each Photo shown with the per-photo details the
report leaves switched on: its number, who captured it, where ("location
captured" — the Job's property address, as Photos carry no GPS), when it was
captured, and its tags. Carries a slim footer (Section name + page number)
and no running top header.
_Avoid_: gallery page, grid page, photo grid

**Report Settings** (of a Photo Report):
The per-report set of look choices a Photo Report renders with — how many
Photos sit on a Photo Page (2/3/4, which also fixes the Section write-up's
character cap) and the show/hide switches for Section Title Pages and each
per-photo detail. A new report copies these from its Organization's **Report
layout default**; from then on the report keeps its own copy, so changing the
Organization default never rewrites a report that already exists. Parallel in
shape to a billing document's **PDF layout** (the per-document copy) versus
its **PDF preset** (the Organization default it was seeded from) — see
[ADR 0014](docs/adr/0014-photo-reports-carry-per-report-cover-and-layout.md).
_Avoid_: report layout (unqualified), report preset, report look

**Report layout default** (of an Organization):
The Organization-wide default **Report Settings** that every new Photo Report
is seeded from, set once in Settings. Distinct from a **Photo Report
template**, which seeds a report's Sections, not its look.
_Avoid_: company report settings, default report layout, report preset

**Photo Report template**:
A saved, reusable set of Sections (headings plus optional boilerplate
write-up text) that an Organization starts a new Photo Report from, so
common report structures aren't retyped; the result stays fully editable.
Belongs to one Organization. Distinct from an **Estimate** template, a
separate feature (see [ADR 0004](docs/adr/0004-template-line-items-snapshot.md)).
_Avoid_: preset (in code — "preset" is older UI copy), report template (unqualified), layout

**Estimate**:
A priced proposal for a Job — line items grouped into sections, with markup,
discount, and tax — that an Organization sends a customer for approval. The
primary billing document, and the only thing an Invoice can be made from.
_Avoid_: quote, proposal, bid (quote/bid fine in UI copy)

**Invoice**:
A request for payment for a Job, created only by converting an Estimate —
never authored on its own. Unlike an Estimate it carries a due date, a payment
state, and QuickBooks sync; a deposit or staged payment is a partial payment on
the single Invoice, never a second Invoice.
_Avoid_: bill (fine in UI copy), receipt

**PDF preset**:
A saved, reusable set of look-preferences for the customer-facing PDF of an
Estimate or Invoice — which parts show (markup, discount, tax, opening and
closing statements, code column, category subtotals, the document-title
heading, and item notes) plus the title text. Belongs to one Organization and
is the starting point a document's PDF layout is copied from. Exactly one of
an Organization's presets is its **default preset**, the look any document
uses until it is given a layout of its own. Distinct from a Photo Report
template, which the photo-report UI historically also called a "preset" — see
Flagged ambiguities; the two are always qualified by document.
_Avoid_: template (that's the Estimate/Photo-Report feature), style, theme,
bare "preset" outside the billing-PDF context

**PDF layout**:
The set of show/hide choices a single specific Estimate or Invoice is
rendered with — its own copy of the preferences, stored on that document. A
document with no layout falls back to its Organization's **default preset**;
the moment its look is changed it takes a complete layout of its own and stops
following the default (it never half-follows). A layout sticks to its
document and is frozen along with it — once the Estimate is converted or the
Invoice is paid or voided, the look is locked, so the record keeps exactly the
look it was approved or billed with. The look a document actually renders with
is resolved by a pure precedence rule: the document's own layout wins over the
default preset; absent a layout, the default applies. See
[ADR 0012](docs/adr/0012-pdf-layout-is-a-per-document-snapshot.md).
_Avoid_: format, theme, bare "layout" outside the billing-PDF context, View
(that's the screen a layout is edited on, not the layout itself)

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

**Showcase**:
A public-facing story of one Job — selected Photos plus a write-up — that
markets the Organization's work. The write-up is AI-drafted on request,
human-edited, and published as a real post on the Organization's connected
WordPress site; a published Showcase is also the source material social
posts are drafted from. At most one per Job, started manually from the Job
(any status) — never auto-created; the Marketing area nudges by listing
recently-completed Jobs without one. Drafts scrub identifying customer
details by default (city-level location only, no names or exact addresses),
and publishing requires a one-click confirmation that the customer is OK
with the photos going public.
_Avoid_: portfolio item, case study, project post (those are renderings of
a Showcase, not the thing itself)

**Website connection**:
An Organization's credentialed link to its own public marketing website,
which Showcase publishing writes posts onto. WordPress-only at first: the
site URL plus a WordPress Application Password scoped to writing posts —
created by the business, pasted into Nookleus settings, revocable from
WordPress at any time, stored encrypted. Same trust shape as a QuickBooks
connection or an Email account: per-Organization, opt-in, never a shared
admin login. An Organization without one simply has no site publishing.
_Avoid_: site integration, WP hookup, website sync

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
- A **Job** has zero or more **Estimates**; each Estimate converts into at most one **Invoice**, and every Invoice is born from exactly one Estimate — conversion is the only way to create one. A deposit or staged payment is a partial payment on that single Invoice, not an additional Invoice. See [ADR 0007](docs/adr/0007-estimates-are-the-single-billing-entry-point.md).
- An **Estimate** or **Invoice** has zero or one **PDF layout** of its own; with none it renders using its Organization's **default preset**. A document's own layout always wins over the default, resolved by a pure precedence rule, and is locked once the document is frozen (Estimate converted, Invoice paid or voided). A **PDF preset** belongs to one **Organization** and seeds a document's layout; applying one copies its preferences in, it is not a binding link.
- A **Job** has zero or more **Photo Reports**; each Photo Report belongs to exactly one Job, gathers that Job's **Photos** into ordered **Sections**, and is created and edited only from within the Job. Reports are numbered per Job (Report #1, #2, …). Each Photo Report also owns a per-report **Cover Page** and per-report **Report Settings**, seeded from the Organization at creation (the settings from the **Report layout default**, the cover photo from the Job) and editable per report thereafter — a later change to the Organization default does not rewrite an existing report.
- A **Photo Report template** belongs to one **Organization** and seeds a new Photo Report's **Sections**; applying one is a starting point, not a binding link.
- A **Job** has zero or one **Showcase**; a Showcase belongs to exactly one Job and gathers that Job's **Photos** plus a write-up for public marketing.
- An **Organization** has one **Report layout default**; it seeds every new Photo Report's **Report Settings** at creation and is not a binding link (the report keeps its own copy). Distinct from a **Photo Report template**, which seeds Sections rather than look.

## Example dialogue

> **Dev:** "When a route asks for a Request Context, does it always get a Service client?"
> **Maintainer:** "No — only the User client by default. The Service client bypasses Organization scoping, so a route has to explicitly opt in, and that opt-in is visible right at the route's declaration."

## Flagged ambiguities

- "auth gate" was used for four near-identical route helpers (`requirePermission`, `requireAdmin`, `requireViewAccounting`, and an inline `requireLogExpenses`) — resolved: these collapse into the one **Request Context** wrapper.
- "active" was being used for two unrelated concepts in `src/lib/accounting/margins.ts`: (a) a job with financial activity in a reporting period, and (b) a non-completed job (the user-facing filter pill on the Job Profitability page, which also folds cancelled jobs in with active ones). Neither matches the canonical **Active job** definition above. The dashboard rebuild adopts the canonical meaning; the accounting page is left as-is for now but is a cleanup candidate.
- "section" is used for two unrelated concepts: an **Estimate** Section (a group of priced line items) and a **Photo Report** Section (a heading + one-page write-up + photos). Resolved: both keep the word but are always qualified by their document ("Estimate section" vs "Photo Report section"); they share no table, type, or component.
- "template" is likewise overloaded: an **Estimate** template (see [ADR 0004](docs/adr/0004-template-line-items-snapshot.md)) and a **Photo Report** template. Resolved: always qualify by document. Note the older Photo-Report builder UI also called these "presets" — the canonical term is **Photo Report template**; "preset" is an alias to retire _there_.
- "preset" and "layout" are overloaded across domains. On the **Photo Report** side both are words to avoid (canonical term: **Photo Report template**). On the **billing-PDF** side they are first-class and canonical — a **PDF preset** (reusable saved look) and a **PDF layout** (the look stuck to one Estimate/Invoice). Resolved the same way as "section"/"template": always qualify by document, so bare "preset"/"layout" never appear unqualified. The billing-PDF preset has lived in the code (`pdf_presets`) since before this was written; ADR 0007 explicitly left that system out of its scope.
