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
from a Contact with exactly one Open job) and prompted-for otherwise.
Untagged events live only in the Phone tab; tagged events also surface on
the Job's card. Visibility follows the tag: a Job-tagged event on a
Personal phone number is team-visible (because Job content is company
business), whereas an untagged event on the same Personal number is
owner-only — see [ADR 0005](docs/adr/0005-shared-and-personal-phone-numbers.md).
_Avoid_: job link, attribution, assignment

**Call recording**:
The recorded audio of an _answered_ voice call (inbound or outbound bridge) —
one `phone_recordings` row per call, with the audio copied into Nookleus's own
storage so it outlives Twilio's retention and deletion is under the
Organization's control. Distinct from a **Voicemail** (an unanswered call's
left message, which has its own row and transcript). Recording is on by default
per Organization (`recording_enabled_default`), with a per-call override on the
outbound bridge; every recorded call plays the Recording consent notice at the
start — see [ADR 0006](docs/adr/0006-twilio-as-telephony-backbone.md).
_Avoid_: tape, capture, the call log

**Recording consent notice**:
The single, legally-required spoken line played to _both_ parties at the start
of every recorded call: "This call may be recorded for quality and reference."
Its one source of truth is `src/lib/phone/recording-consent.ts`, snapshot-pinned
so the wording can never change silently; it covers all 50 states including
two-party-consent jurisdictions. The initiating party hears it before the dial;
the answering party hears the same line via a per-leg whisper.
_Avoid_: disclaimer, warning, disclosure

**Intake**:
The hand-logging of a new customer lead: a member fills out the **New Customer
Intake** form (`/intake`, `intake-form.tsx`) when a lead comes in, and a single
submit creates the **Job** along with its **Contact**, any adjuster link, custom
fields, and a first "Intake notes" activity. "An intake" means both the act and
the Job it produces — the moment a Job is born by hand, distinct from Jobs created
as a side effect elsewhere (e.g. from a payment or a Referral Partner's job list).
Submitting an intake is the event that buzzes the rest of the team — see
[ADR 0018](docs/adr/0018-new-intake-push-notifications.md).
_Avoid_: prospect, enquiry, ticket; "a lead" for the act (the intake is the act of
logging the job; **Lead** is the **Job status** the resulting Job is born into — so
"lead" names the Job's stage, never the act); "new job" (that names the resulting record, not the act)

**Urgency**:
A Job's response-time tier — one of three fixed values, `emergency`, `urgent`, or
`scheduled` (the default) — chosen on the **Intake** form and shown thereafter as a
colored badge (shared `urgencyLabels`/`urgencyColors`). It says how fast the team
must move, not where the Job sits in its lifecycle (that is its **status**): the
Jobs page floats emergencies to the top, and the new-intake notification speaks the
tier — an 🚨 emergency leads the title, and each tier carries its own sound.
_Avoid_: priority, severity, importance (fine in UI copy)

**Job status**:
The lifecycle stage a Job sits in — one of five, in pipeline order: **Lead**
(a new job just logged; the sale not yet won), **Active** (a contract is
signed and the work is live), **Collections** (the work is billed and payment
is being chased), **Closed** (finished and settled), and **Lost** (the job
fell through — the renamed "dead" state). A Job is born a **Lead** at
**Intake**. Signing a contract is the one automatic move: it advances a
**Lead** — or revives a **Lost** job — to **Active**, and never drags a job
already further along backward; every other move is a deliberate user choice.
Says where a Job is in its lifecycle, distinct from its **Urgency** (how fast
to respond) and from a Referral Partner's **Lifecycle status** (a different
four-state concept on a different list).
_Avoid_: stage, phase, pipeline status, label (in code — "label" is fine in
UI copy); "Active" for the whole alive set (that is an **Open job**)

**Open job**:
A Job that is still alive — its **Job status** is **Lead**, **Active**, or
**Collections** (i.e. not **Closed** and not **Lost**), and it has not been
trashed (`deleted_at IS NULL`). A **Lost** job is dormant, not open; a
**Closed** job is done. The dashboard's "Jobs to advance" and "People to
respond to" sections, and the Jobs page's headline count (shown as "Open
jobs"), all filter to Open jobs only. Renamed from the earlier "Active job"
once **Active** became a single **Job status** and the two would have collided.
_Avoid_: active job (collides with the **Active** status), current job,
running job, in-progress job (that one is a specific status, not the whole alive set)

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
A priced proposal for a Job — line items grouped into sections, with overhead
& profit, discount, and tax — that an Organization sends a customer for
approval. The primary billing document, and the only thing an Invoice can be
made from.
_Avoid_: quote, proposal, bid (quote/bid fine in UI copy)

**Estimate line item**:
A single priced row on an Estimate. Its unit price is what the Organization
**charges the customer** for that item — not the Organization's internal cost.
The app deliberately stores no contractor cost basis: there is no "what it
costs us" figure anywhere, so margin is never computed.
_Avoid_: "unit cost" (the current column label is a misnomer — the value is
the charge, not a cost), line, entry

**Overhead & Profit (O&P)**:
Two optional uplifts — the contractor's "10 & 10" (commonly 10% each) — added
**on top of** an Estimate's Subtotal to reach the customer's price. Each is a
percentage (or flat dollar) the customer ultimately pays; together they are the
Estimate's **Markup**. They are additive charges applied to the Subtotal, never
a margin back-calculated against a cost (there is no cost to back-calculate
against).
_Avoid_: using "overhead"/"profit" to mean an internal cost breakdown or
job-margin worksheet; treating "markup" as one field (it decomposes into
Overhead + Profit)

**Subtotal**:
The sum of an Estimate's line-item charges, before Overhead & Profit, Discount,
and Tax.
_Avoid_: "Costs" (rejected — it reads as the contractor's expenses, which the
app does not track and never shows the customer)

**Tax**:
A single rate applied **after** Overhead & Profit and Discount — i.e. on the
adjusted Subtotal, not the raw Subtotal — yielding the tax the customer pays.
_Avoid_: VAT, GST (a single US rate today)

**Invoice**:
A request for payment for a Job, created only by converting an Estimate —
never authored on its own. Unlike an Estimate it carries a due date, a payment
state, and QuickBooks sync; a deposit or staged payment is a partial payment on
the single Invoice, never a second Invoice.
_Avoid_: bill (fine in UI copy), receipt

**Invoiced** (Financials figure):
The sum of a Job's sent-or-later Invoices — `sent`, `partial`, or `paid`;
drafts and voided are excluded (see [ADR 0007](docs/adr/0007-estimates-are-the-single-billing-entry-point.md)).
The "what you've billed on this Job so far" figure on the Financials tab.
_Avoid_: billed, total invoices (drafts and voided do not count)

**Collected**:
The sum of a Job's received payments. A payment can land before any Invoice
exists — a deposit is routinely taken before an Estimate is even written — so
Collected may be positive while Invoiced is still $0, and may even run past
Invoiced (the Job is then "paid ahead"). Billing and collecting are
independent: Collected is not a slice of Invoiced.
_Avoid_: paid, revenue, income

**Outstanding**:
Invoiced − Collected: the Job's unpaid receivable. Meaningful only once an
Invoice exists; when Collected has run past Invoiced the Job is **paid ahead**,
not outstanding.
_Avoid_: balance, amount due, owed

**Collection rate**:
Collected ÷ Invoiced — the share of what's been billed that has actually been
paid, drawn as the collection ring on the Financials tab (see [ADR 0021](docs/adr/0021-financials-tab-job-profit-and-collection-ring.md)).
Undefined until an Invoice exists: the tab shows "not invoiced yet" in place of a
ring, which is the common early-Job state because deposits precede billing.
_Avoid_: paid percentage, collection ratio

**Crew labor**:
A Job's estimated crew-labor cost (`estimated_crew_labor_cost`) — a single,
hand-entered figure the owner sets per Job. It is the **one cost basis the app
keeps**: a deliberate, narrow exception to the rule that Nookleus stores no
contractor cost (see Estimate line item), narrow because it is always an
*estimate*, never a captured or actual labor cost (Job timesheets record hours,
not dollars). It feeds **Job profit**, and the Financials tab labels it "(est.)"
so it is never read as a billed or actual figure.
_Avoid_: labor cost, actual labor, payroll

**Job profit**:
A Job's running cash position on the Financials tab: Collected − Expenses −
Crew labor (the Job's estimated crew-labor cost). It is **not** an accounting
margin — it blends actual cash (Collected, Expenses) with an estimate (Crew
labor), swings over a Job's life, and is marked "(in progress)" until the Job
is completed. The rule that the app computes no cost-basis margin (see Estimate
line item) is about **Estimate pricing**; Job profit is cash-in minus cash-out
minus estimated crew labor — a different thing, deliberately kept apart from an
Estimate's **Markup** / **Overhead & Profit** (see [ADR 0021](docs/adr/0021-financials-tab-job-profit-and-collection-ring.md)).
_Avoid_: gross margin (the former UI label and the `gross_margin` code field —
a misnomer: it is not a cost-basis margin), margin, profit margin, net

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

**Job timesheet**:
A document an Organization generates from a Job's recorded labor — per-worker
totals plus a chronological list of sessions over a chosen date range — and
exports as a PDF to send alongside an **Invoice**, built to stand up to a harsh
insurance review. Belongs to exactly one Job. Records **hours only**: it carries
no billing rates and no location stamp — its weight comes from auditable time and
an owner/lead **certification**, not GPS (see [ADR 0019](docs/adr/0019-timesheets-record-defensible-hours-not-location.md)).
Generated, certified, and listed on the Job like a numbered **Photo Report**;
once signed its PDF is frozen and never regenerated (the signed-contract rule —
[ADR 0011](docs/adr/0011-signed-contract-pdfs-are-immutable.md)).
_Avoid_: timecard, time report, labor report, payroll (it is explicitly not payroll)

**Certification** (of a Job timesheet):
The owner's or lead's sign-off that closes a **Job timesheet** — a printed
attestation that the recorded hours are accurate, stamped with their drawn or
saved signature at generation time. It is what gives the sheet its evidentiary
weight for an insurer, in place of GPS (see [ADR 0019](docs/adr/0019-timesheets-record-defensible-hours-not-location.md)),
and signing it **freezes** the PDF (the signed-contract rule —
[ADR 0011](docs/adr/0011-signed-contract-pdfs-are-immutable.md)). v1 is a single
owner/lead Certification, not a per-worker signature.
_Avoid_: sign-off, approval, e-signature (that names the mechanism, not the act)

**Time session**:
The atomic unit of recorded labor: one worker, on one Job, from a **Clock in** to
a **Clock out** — the hours are the span between. The worker is either an app
**User** or an **Off-app worker**, never both. A person has at most one **Open
session** at a time; clocking into a different Job closes the previous one. The
hours of a session split into **Regular** and **Premium** (see [ADR 0020](docs/adr/0020-labor-hour-classification-and-org-timezone.md)).
_Avoid_: shift (implies a scheduled workday), punch, time entry, clock event

**Open session**:
A **Time session** that has a clock-in but no clock-out yet — someone currently
working. A person has at most one across all Jobs. The presence surfaces ("On the
clock", "On site now") are built from the set of Open sessions.
_Avoid_: active session, current clock, open punch

**Clock in / Clock out**:
The acts of starting and ending one's own **Time session** by tapping in the app
on site. **Crew members can only live-clock themselves** in and out — they can
never type or edit a time; changing a recorded time is a **Correction**
(leads/admins only).
_Avoid_: punch in/out, check in/out, sign in (that is authentication)

**Regular hours**:
Labor hours at the base rate: worked Monday–Friday between 7am and 5pm, up to 8
hours in a calendar day. Everything outside that window is **Premium hours**.
Bucketed in the **Organization timezone**, not the device's. See [ADR 0020](docs/adr/0020-labor-hour-classification-and-org-timezone.md).
_Avoid_: standard hours, straight time, normal time

**Premium hours**:
Labor hours above the base rate — a single tier covering both overtime and
after-hours, because the Organization bills them at one rate. Premium = before
7am or after 5pm on a weekday, all hours on Saturdays, Sundays, and US federal
holidays, or any hours past 8 in a calendar day. Each premium stretch is labelled
with its reason (overtime / evening / weekend / holiday), but the reason never
changes the rate — premiums do **not** stack. See [ADR 0020](docs/adr/0020-labor-hour-classification-and-org-timezone.md).
_Avoid_: overtime (that is one reason for Premium, not the whole tier), OT,
after-hours (likewise), time-and-a-half

**Off-app worker**:
A person whose hours appear on a **Job timesheet** but who is not an app
**User** — e.g. day labor or a sub helping for a day. Entered by name by a lead,
carries hand-entered hours only, and never self-clocks or shows on a live
presence board. Distinct from a **vendor subcontractor** (an outside *company*
whose bills the Organization records as expenses — a `vendor` type); the two are
unrelated despite both meaning "outside help" — see Flagged ambiguities.
_Avoid_: subcontractor (collides with the vendor sense), sub, guest, contractor

**Correction** (of a Time session):
A lead's or admin's edit to a session's times — or a session created entirely by
hand — used when someone forgot to clock in or out, a phone died, or an **Off-app
worker**'s day must be recorded. Times are **never auto-fabricated**; every
Correction is audit-logged (who, when, old → new) and the session is marked
hand-entered so it is visibly distinguishable on the **Job timesheet** from a live
clock.
_Avoid_: edit, adjustment, override, manual entry (use "hand-entered")

**On the clock**:
The set of people with an **Open session** right now. Surfaced two ways: per-Job
("On site now", visible to anyone who can view the Job) and company-wide ("On the
clock now" on the owner's dashboard, a leads/admins view). **Off-app workers**
never appear here — only on the printed **Job timesheet**.
_Avoid_: online, present, active, checked in

**Organization timezone**:
The single timezone an Organization's labor hours are bucketed and classified
against — defaulted from its business address, set in Settings. It is
authoritative: **Regular**/**Premium** classification is computed server-side
against this zone, never an individual device's clock, so the same session yields
the same hours no matter whose phone recorded it. See [ADR 0020](docs/adr/0020-labor-hour-classification-and-org-timezone.md).
_Avoid_: local time, device time, user timezone

## Relationships

- A **User** belongs to one or more **Organizations**; each membership carries a role.
- A **Request Context** names exactly one **Active Organization**.
- A **Request Context** always carries a **User client**; it carries a **Service client** only when the route opts in.
- An **Email account** belongs to one **Organization**; a **Personal email account** is additionally owned by one **User**, a **Shared email account** by none.
- An **Outgoing email** belongs to one **Organization** and names exactly one **Email account** (the mailbox the document is sent from). There is one Outgoing email per document kind per Organization.
- A **Phone number** belongs to one **Organization**; a **Personal phone number** is additionally owned by one **User**, a **Shared phone number** by none.
- A **Conversation** is identified by the pair (one of the Organization's Phone numbers, one outside phone number) and groups its events on the Contact whose phone number matches the outside number.
- A **Job tag** ties one text or call event to exactly zero or one **Job**. A single Conversation may contain events with several different Job tags (or none).
- A **Call recording** belongs to exactly one answered voice call (one recording per call); deleting the call cascades the recording, and deleting the recording also hard-deletes it on Twilio. Whether a call records is governed per **Organization** by `recording_enabled_default`, overridable per call on the outbound bridge — see [ADR 0006](docs/adr/0006-twilio-as-telephony-backbone.md).
- A row on the Referral Partners call list belongs to one **Organization** and is called either a **Target** or a **Referral Partner** depending on its **Lifecycle status** — same row, different name.
- An **Intake** produces exactly one **Job** (and the **Contact** it belongs to) in a single submit; that submission is what notifies the rest of the team of the new Job, carrying its **Urgency** tier — see [ADR 0018](docs/adr/0018-new-intake-push-notifications.md).
- A **Job** has zero or one referring **Referral Partner** (the Partner who sent the job our way). Only Active rows are eligible — see [ADR 0002](docs/adr/0002-only-active-partners-attach-to-jobs.md).
- A **Job** has zero or more **Estimates**; each Estimate converts into at most one **Invoice**, and every Invoice is born from exactly one Estimate — conversion is the only way to create one. A deposit or staged payment is a partial payment on that single Invoice, not an additional Invoice. See [ADR 0007](docs/adr/0007-estimates-are-the-single-billing-entry-point.md).
- An **Estimate** or **Invoice** has zero or one **PDF layout** of its own; with none it renders using its Organization's **default preset**. A document's own layout always wins over the default, resolved by a pure precedence rule, and is locked once the document is frozen (Estimate converted, Invoice paid or voided). A **PDF preset** belongs to one **Organization** and seeds a document's layout; applying one copies its preferences in, it is not a binding link.
- A **Job** has zero or more **Photo Reports**; each Photo Report belongs to exactly one Job, gathers that Job's **Photos** into ordered **Sections**, and is created and edited only from within the Job. Reports are numbered per Job (Report #1, #2, …). Each Photo Report also owns a per-report **Cover Page** and per-report **Report Settings**, seeded from the Organization at creation (the settings from the **Report layout default**, the cover photo from the Job) and editable per report thereafter — a later change to the Organization default does not rewrite an existing report.
- A **Photo Report template** belongs to one **Organization** and seeds a new Photo Report's **Sections**; applying one is a starting point, not a binding link.
- A **Job** has zero or one **Showcase**; a Showcase belongs to exactly one Job and gathers that Job's **Photos** plus a write-up for public marketing.
- An **Organization** has one **Report layout default**; it seeds every new Photo Report's **Report Settings** at creation and is not a binding link (the report keeps its own copy). Distinct from a **Photo Report template**, which seeds Sections rather than look.
- A **Time session** belongs to one **Organization** and one **Job** and names exactly one worker — either an app **User** or an **Off-app worker**, never both. A person has at most one **Open session** across all Jobs; clocking into another Job closes the prior session. An **Off-app worker** has no record of its own — it is just the typed name carried on its sessions.
- A **Job** has zero or more **Time sessions** and zero or more **Job timesheets**; each Job timesheet is generated from that Job's sessions over a chosen date range, numbered per Job (like a **Photo Report**), and frozen once certified-and-signed (see [ADR 0011](docs/adr/0011-signed-contract-pdfs-are-immutable.md), [ADR 0019](docs/adr/0019-timesheets-record-defensible-hours-not-location.md)).
- A **Time session**'s hours split into **Regular** and **Premium**, classified against the **Organization timezone** (see [ADR 0020](docs/adr/0020-labor-hour-classification-and-org-timezone.md)); a session crossing midnight is split at the calendar-day boundary.
- An **Organization** has exactly one **Organization timezone**, defaulted from its business address.

## Example dialogue

> **Dev:** "When a route asks for a Request Context, does it always get a Service client?"
> **Maintainer:** "No — only the User client by default. The Service client bypasses Organization scoping, so a route has to explicitly opt in, and that opt-in is visible right at the route's declaration."

## Flagged ambiguities

- "auth gate" was used for four near-identical route helpers (`requirePermission`, `requireAdmin`, `requireViewAccounting`, and an inline `requireLogExpenses`) — resolved: these collapse into the one **Request Context** wrapper.
- "active" was being used for two unrelated concepts in `src/lib/accounting/margins.ts`: (a) a job with financial activity in a reporting period, and (b) a non-completed job (the user-facing filter pill on the Job Profitability page, which also folds cancelled jobs in with active ones). Neither matches the canonical **Open job** definition above. The dashboard rebuild adopts the canonical meaning; the accounting page is left as-is for now but is a cleanup candidate.
- "active" gained a _third_ sense when Job statuses were relabeled (Lead / Active / Collections / Closed / Lost): **Active** is now a single **Job status** — a signed, live job (formerly the `in_progress` status). Resolved: the alive-set concept is renamed **Open job** (UI stat "Open jobs"), and "Active" is reserved for the one status. The code's internal `ACTIVE_STATUSES` list and `active` filters keep their names but denote the Open-job set; the relabel is glossary/UI-level — the underlying status keys (`new`, `in_progress`, `pending_invoice`, `completed`, `cancelled`) are unchanged, only their display labels move (Lead, Active, Collections, Closed, Lost).
- "section" is used for two unrelated concepts: an **Estimate** Section (a group of priced line items) and a **Photo Report** Section (a heading + one-page write-up + photos). Resolved: both keep the word but are always qualified by their document ("Estimate section" vs "Photo Report section"); they share no table, type, or component.
- "template" is likewise overloaded: an **Estimate** template (see [ADR 0004](docs/adr/0004-template-line-items-snapshot.md)) and a **Photo Report** template. Resolved: always qualify by document. Note the older Photo-Report builder UI also called these "presets" — the canonical term is **Photo Report template**; "preset" is an alias to retire _there_.
- "preset" and "layout" are overloaded across domains. On the **Photo Report** side both are words to avoid (canonical term: **Photo Report template**). On the **billing-PDF** side they are first-class and canonical — a **PDF preset** (reusable saved look) and a **PDF layout** (the look stuck to one Estimate/Invoice). Resolved the same way as "section"/"template": always qualify by document, so bare "preset"/"layout" never appear unqualified. The billing-PDF preset has lived in the code (`pdf_presets`) since before this was written; ADR 0007 explicitly left that system out of its scope.
- "subcontractor" is overloaded. In the existing code it is a **`vendor` type** (`VendorType`, `src/lib/types.ts`) — an outside *company* whose bills the Organization records as job expenses. The new time-tracking feature also has outside help — an individual hired for a day whose *hours* go on a **Job timesheet** — but that is a different thing entirely (a person's labor, not a company's invoice). Resolved: the timesheet person is an **Off-app worker**; "subcontractor" stays reserved for the vendor sense, and the two never share a table or term.
- "margin" / "gross margin" was overloaded. The Financials tab's bottom-line figure was labelled **Gross margin** and the code field is `gross_margin` (`src/lib/accounting/margins.ts`), yet the glossary says the app computes no cost-basis margin. Resolved: the figure is renamed **Job profit** (a job cash position, not an accounting margin); "margin" is reserved for the Estimate-pricing discussion (**Markup** / **Overhead & Profit**), where the no-cost-basis rule genuinely holds. The `gross_margin`/`margin_pct` code fields are a rename cleanup candidate, mirroring the `margins.ts` "active" note above.
