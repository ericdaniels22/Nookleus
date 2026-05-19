# Request Context — ungated-endpoint list

Final published list of API endpoints that the Request Context conversion
slices (#79–#85) wrapped **logged-in-only** (`withRequestContext({}, …)` or
`withRequestContext({ serviceClient: true }, …)`) because they had **no
permission gate at all** before the conversion.

The conversion is behavior-preserving by design (PRD #78): an endpoint with
no prior gate is wrapped logged-in-only, which matches its prior behavior —
it is **not** tightened here. This document is the deliverable that turns
"endpoints with no check" into a tracked, triageable list. **Tightening any
of these is a separate follow-up.**

This is the complete, published list — slice #86 assembled the remaining
feature areas (#80–#85) and published this final version. Each slice's
feature area is recorded in its own `## #NN` section below.

---

## #79 — expenses (tracer)

All wrapped `{ serviceClient: true }` (logged-in-only; Service client opt-in):

- `GET /api/expenses/by-job/[jobId]`
- `GET /api/expenses/by-activity/[activityId]`
- `GET /api/expenses/[id]/thumbnail-url`
- `GET /api/expenses/[id]/receipt-url`

The four `by-*` / `*-url` GETs additionally read expenses with the Service
client **without org-scoping** — a pre-existing data-scoping gap, flagged in
code comments for the triage follow-up. **Closed by [#101](#101--expenses-service-client-gets-org-scoping)**
— each now calls the Active-Organization scoping guard before the read.

---

## #84 — settings

`settings` is the area PRD #78 calls out as most likely to contain real
access-control gaps. The conversion wrapped 35 previously-ungated endpoints
logged-in-only. Grouped by sub-area:

### ⚠️ users — highest-priority triage

These mutate org membership, roles, profiles, and permission grants with
**no permission gate**. They should almost certainly require an admin /
`access_settings`-class permission. Flagged for urgent triage.

- `GET /api/settings/users` — lists all members of the active org
- `POST /api/settings/users` — invites a new user, sets role + permissions
- `PATCH /api/settings/users/[id]` — edits a profile, role, and active/ban state
- `GET /api/settings/users/[id]/permissions` — reads a member's permission grants
- `PUT /api/settings/users/[id]/permissions` — **rewrites a member's permission grants**

### contract-templates

- `GET /api/settings/contract-templates` — list templates
- `GET /api/settings/contract-templates/[id]` — read one template (also **not org-scoped**)
- `DELETE /api/settings/contract-templates/[id]` — soft-archive (`is_active=false`); also **lacks an organization filter** — any logged-in user can archive any org's template by id
- `GET /api/settings/contract-templates/[id]/pdf` — short-lived signed URL for the template PDF
- `GET /api/settings/contract-templates/jobs` — recent-jobs picker for the preview modal
- `POST /api/settings/contract-templates/preview` — merge-field-resolved HTML preview

### intake-form

- `GET /api/settings/intake-form` — latest form config
- `POST /api/settings/intake-form` — save a new form-config version
- `GET /api/settings/intake-form/custom-fields` — per-job custom field values
- `POST /api/settings/intake-form/restore` — restore an older form-config version
- `GET /api/settings/intake-form/usage` — template references of form fields
- `GET /api/settings/intake-form/versions` — version history

### company / appearance / branding

- `GET /api/settings/company` · `PUT /api/settings/company` — company settings key/value store
- `GET /api/settings/appearance` · `PUT /api/settings/appearance` — brand colors
- `POST /api/settings/company/logo` — upload the company logo

### catalogs (statuses / damage-types)

- `GET`, `POST`, `PUT`, `DELETE /api/settings/statuses` — job-status catalog
- `GET`, `POST`, `PUT`, `DELETE /api/settings/damage-types` — damage-type catalog

### email

- `GET /api/settings/contract-email` · `PATCH /api/settings/contract-email` — contract email settings
- `GET /api/settings/signatures` · `PUT /api/settings/signatures` — per-account email signatures

### data export

- `GET /api/settings/export` — CSV export of jobs / contacts / payments / invoices / emails / activities

### nav

- `GET /api/settings/nav-order` — admin-configured nav order (read)

---

## #84 — settings: notes (not in the list above)

A few `settings` endpoints are **not** counted as previously-ungated, with
the reasoning recorded here so the triage follow-up has the full picture:

- `PUT /api/settings/nav-order` — had an inline admin check that accepts
  admin in **any** org the caller belongs to (nav_items is product-level).
  `withRequestContext`'s `adminOnly` rule only checks the Active
  Organization, so this route is wrapped `{}` and **keeps the any-org admin
  check as its own business logic**. Still gated — not ungated.
- `GET /api/settings/expense-categories`, `GET /api/settings/vendors` — each
  had an explicit inline `getUser()` 401 check, i.e. were already
  logged-in-only. Wrapped `{}` / `{ serviceClient: true }`; no change.
- `GET /api/settings/contract-templates/[id]/preview` — was gated on
  `manage_contract_templates` but, by design, fell back to any logged-in
  member of the active org (it is opened from send-contract / sign-in-person
  modals). Its effective policy was always "logged-in", so it is wrapped
  `{}`. The route renders only sample data, no contract PII.

---

## #80 — contracts

All wrapped `{ serviceClient: true }` (logged-in-only; Service client
opt-in) **except** `by-job/[jobId]`, which is wrapped `{}`. The 10
serviceClient routes each had an inline `getUser()` 401 check before
conversion — already logged-in-only, no permission gate.

- `POST /api/contracts/send` — send a contract for signature
- `GET /api/contracts/preflight` — pre-send validation/readiness check
- `POST /api/contracts/in-person` — create an in-person signing session
- `POST /api/contracts/in-person/start` — begin an in-person signing flow
- `POST /api/contracts/[id]/void` — void a sent contract
- `DELETE /api/contracts/[id]` — soft-delete a contract
- `POST /api/contracts/[id]/restore` — restore a soft-deleted contract
- `POST /api/contracts/[id]/resend` — resend the signing request
- `POST /api/contracts/[id]/remind` — send a signing reminder
- `GET /api/contracts/[id]/pdf` — signed URL / stream for the contract PDF

### ⚠️ by-job — no prior auth at all

- `GET /api/contracts/by-job/[jobId]` — list contracts for a job. Wrapped
  `{}`. Had **no auth check whatsoever** before conversion (relied on
  User-client RLS only); the wrapper now adds a logged-in gate.

item-library routes were all given real permission rules; nothing from
item-library is logged-in-only.

---

## #81 — invoices + estimates

Both wrapped `{ serviceClient: true }`. Each had an inline `getUser()` 401
check before conversion — already logged-in-only, no permission gate.

- `POST /api/invoices/[id]/void` — void an invoice
- `POST /api/invoices/[id]/mark-sent` — mark an invoice as sent

All other invoices + estimates routes got real permission rules; nothing
else from this slice is logged-in-only.

#### Triage outcome — #104 (PRD #95)

Both endpoints are now gated, matching the existing invoice gates and the
canonical permission vocabulary (#96):

- `POST /api/invoices/[id]/void` → `manage_invoices`. Void is a heavy
  lifecycle mutation; its siblings `/send`, `/delete`, `/restore`, and
  `DELETE /api/invoices/[id]` all require `manage_invoices`.
- `POST /api/invoices/[id]/mark-sent` → `edit_invoices`. mark-sent only
  flips the status `draft → sent` (the same DB effect as the
  `edit_invoices`-gated `PUT /api/invoices/[id]/status`). `/send` carries
  `manage_invoices` because it additionally delivers email; mark-sent does
  not, so it sits with the lighter edit-class gate rather than `/send`'s.

Both keep `serviceClient: true`. Admins pass without holding the key; a
member lacking it now gets 403.

---

## #82 — accounting + QuickBooks

**Nothing from this slice was wrapped logged-in-only.** Every accounting
route got `{ permission: "view_accounting" }`, and every QuickBooks (`qb`)
route got `{ adminOnly: true }` or a permission rule. There are no
previously-ungated endpoints to track here.

Two `qb` routes were deliberately **not** converted to `withRequestContext`,
because they do not use session-based auth:

- `qb/callback` — OAuth callback; redirect-based auth, no session.
- `qb/sync-scheduled` — Vercel Cron job; authenticated by `CRON_SECRET`.

---

## #83 — jobs + payments + payment-requests

### jobs — files & photos (wrapped `{}`)

- `GET /api/jobs/[id]/files` — list files attached to a job
- `POST /api/jobs/[id]/files` — upload a file to a job
- `PATCH /api/jobs/[id]/files/[fileId]` — rename / update a job file
- `DELETE /api/jobs/[id]/files/[fileId]` — delete a job file
- `GET /api/jobs/[id]/files/[fileId]/url` — signed URL for a job file
- `DELETE /api/jobs/[id]/photos/bulk` — bulk-delete job photos
- `POST /api/jobs/[id]/photos/bulk-tag` — bulk-tag job photos
- `POST /api/jobs/[id]/photos/download` — bulk-download job photos

> **#103 — gated.** These eight no longer run logged-in-only. Reads take
> the job-view key, writes/deletes take the job-edit key, both from the
> canonical #96 vocabulary:
> - `view_jobs` → `GET .../files`, `GET .../files/[fileId]/url`
> - `edit_jobs` → `POST .../files`, `PATCH`/`DELETE .../files/[fileId]`,
>   `DELETE .../photos/bulk`, `POST .../photos/bulk-tag`,
>   `POST .../photos/download`
>
> The download route is treated as a write (`edit_jobs`) per the #103 spec
> — it produces signed URLs for an explicit, multi-select bulk export, a
> heavier action than a single-file view. Admins auto-pass every rule.

### ⚠️ jobs/search — no prior auth at all

- `GET /api/jobs/search` — job search/autocomplete. Wrapped `{}`. Had **no
  auth check whatsoever** before conversion; the wrapper now adds a
  logged-in gate.

> **#103 — gated.** Now requires `view_jobs` (admins auto-pass).

### payments (wrapped `{ serviceClient: true }`, except GET)

The `payments/[id]` mutations had an inline `getUser()` 401 check before
conversion — already logged-in-only, no permission gate.

- `GET /api/payments` — list payments (wrapped `{}`)
- `POST /api/payments` — record a payment
- `PATCH /api/payments/[id]` — update a payment
- `DELETE /api/payments/[id]` — delete a payment

payment-requests routes all got real permission rules; nothing from
payment-requests is logged-in-only.

---

## #85 — email + Jarvis + remaining

### email — content routes (wrapped `{}`)

The email content routes below had **no permission gate** before
conversion — the message-list / send / sync / drafts / counts / contacts /
bulk / mark-all-read / attachments-upload routes had no auth check at all
(relied on RLS); the wrapper now adds a logged-in gate.

- `GET /api/email/[id]` — read one message
- `PATCH /api/email/[id]` — update a message (flags, folder, etc.)
- `GET /api/email/thread/[threadId]` — read a message thread
- `POST /api/email/sync` — sync an account's mailboxes
- `POST /api/email/sync-folder` — sync a single folder
- `POST /api/email/send` — send an email
- `POST /api/email/mark-all-read` — mark a folder/account all read
- `GET /api/email/list` — list messages in a folder
- `POST /api/email/drafts` — save / update a draft
- `GET /api/email/counts` — unread counts per folder/account
- `GET /api/email/contacts` — email contact autocomplete
- `PATCH /api/email/bulk` — bulk message actions
- `POST /api/email/attachments/upload` — upload an attachment
- `GET /api/email/attachments/[id]` — download an attachment

### email — accounts (wrapped `{}`)

- `GET /api/email/accounts` — list connected email accounts
- `POST /api/email/accounts` — connect a new email account
- `PATCH /api/email/accounts/[id]` — update an email account
- `DELETE /api/email/accounts/[id]` — disconnect an email account
- `POST /api/email/accounts/[id]/test` — test an account's connection

### Jarvis

- `POST /api/jarvis/chat` — Jarvis assistant chat (wrapped
  `{ serviceClient: true }`; had an inline `getUser()` 401 check before)

### knowledge (wrapped `{ serviceClient: true }`)

- `POST /api/knowledge/search` — search the knowledge base
- `GET /api/knowledge/documents` — list knowledge documents
- `GET /api/knowledge/documents/[id]` — read a knowledge document
- `DELETE /api/knowledge/documents/[id]` — delete a knowledge document

### marketing (wrapped `{ serviceClient: true }`)

- `GET /api/marketing/assets` — list marketing assets
- `POST /api/marketing/assets` — create a marketing asset
- `DELETE /api/marketing/assets` — delete a marketing asset
- `GET /api/marketing/drafts` — list marketing drafts
- `PATCH /api/marketing/drafts` — update a marketing draft
- `DELETE /api/marketing/drafts` — delete a marketing draft

### notifications (wrapped `{ serviceClient: true }`)

- `GET /api/notifications` — list notifications
- `PATCH /api/notifications` — update notification read state

estimate-templates and stripe routes all got real permission/admin rules;
nothing from them is logged-in-only.

### #85 — special-case routes (not wrapped)

A few #85 routes were deliberately **not** wrapped with
`withRequestContext`, because they use custom auth:

- `jarvis/field-ops`, `jarvis/marketing`, `jarvis/rnd`,
  `knowledge/ingest` — custom auth: a session cookie **or** an
  `x-service-key` header.
- `stripe/webhook` — authenticated by Stripe signature verification.

---

## Triage decisions (PRD #95)

The conversion above is behavior-preserving — it only made "no check"
visible as "logged-in only". PRD [#95](https://github.com/ericdaniels22/Nookleus/issues/95)
is the follow-up that replaces those logged-in-only gates with real
permission rules. Each tightening slice records its decision here.

### #100 — settings/users

The five `settings/users` endpoints flagged above as
[**highest-priority triage**](#️-users--highest-priority-triage) were
logged-in-only — any authenticated member of any role could call them. They
mutate org membership, roles, profiles, ban state, and **permission grants**;
in particular a non-admin could grant themselves every permission via
`PUT /api/settings/users/[id]/permissions`.

All five are now gated on `access_settings` (the `serviceClient` opt-in is
unchanged):

- `GET /api/settings/users` → `{ permission: "access_settings", serviceClient: true }`
- `POST /api/settings/users` → `{ permission: "access_settings", serviceClient: true }`
- `PATCH /api/settings/users/[id]` → `{ permission: "access_settings", serviceClient: true }`
- `GET /api/settings/users/[id]/permissions` → `{ permission: "access_settings", serviceClient: true }`
- `PUT /api/settings/users/[id]/permissions` → `{ permission: "access_settings", serviceClient: true }`

`access_settings` already exists in `PERMISSION_CATALOG` (group "Admin"); no
new key was introduced. It is chosen over a hard `adminOnly` rule so settings
administration can be delegated without granting full admin — consistent with
`stripe/settings` and the rest of `settings/*`. Admins auto-pass a
`permission` rule. A member lacking the key now gets 403 — the wrapper
rejects before the handler runs, closing the self-privilege-escalation hole.

### #98 — contract-templates/[id] org scoping

`GET` and `DELETE /api/settings/contract-templates/[id]` (listed under
[#84](#84--settings)) omitted the Active-Organization filter that their
sibling `PATCH` applies, so any logged-in user could read or soft-archive
another Organization's template by id.

Both handlers now filter on `ctx.orgId` (`.eq("organization_id", ctx.orgId)`),
matching `PATCH`. `DELETE` additionally `.select("id")`s the updated row and
returns 404 when nothing matched. A template in another Organization is now
indistinguishable from a missing one — both return 404 — and behavior is
unchanged for templates in the caller's own Active Organization.

This is a data-scoping correctness fix only; it adds no permission gate.
The **permission rule** for the settings-area routes (including these) is
assigned separately in settings slice [#107](#).

### #99 — marketing / knowledge / notifications / Jarvis chat

These four areas have **no fitting key** in the canonical vocabulary
(`PERMISSION_CATALOG`, 30 keys, [#96](#) — nothing for marketing,
knowledge, notifications, or the Jarvis assistant). Per the PRD default,
#99 **confirms logged-in-only is the intended policy** for each and
records the reasoning, so it is a deliberate decision rather than an
oversight. No rules were changed; three endpoints are flagged for
separate follow-up.

**marketing — ✅ confirmed logged-in-only.** `GET`/`POST`/`DELETE
/api/marketing/assets` and `GET`/`PATCH`/`DELETE /api/marketing/drafts`
(listed under [#85](#85--email--jarvis--remaining)). The asset library
and draft queue hold internal promotional content — no customer PII, no
financials — and every query is already org-scoped
(`.eq("organization_id", ctx.orgId)` on read, write, and delete). Any
member is expected to use the marketing tools (the Jarvis marketing
department writes drafts here). No tighter rule is warranted.
(`POST /api/marketing/drafts` is the dual-mode cookie-or-service-key
handler from the #85 special-case notes — not a logged-in-only
`withRequestContext` endpoint; unchanged.)

**knowledge — reads ✅ confirmed; `DELETE` ⚠️ flagged.** `POST
/api/knowledge/search`, `GET /api/knowledge/documents`, and `GET
/api/knowledge/documents/[id]` are confirmed logged-in-only: the
knowledge base is **product-level, global content** —
`knowledge_documents` has no `organization_id` (confirmed in
`knowledge/ingest`'s insert; rows are keyed by `standard_id`, the IICRC
taxonomy), deliberately shared across all orgs and read by the Jarvis
field-ops department. The absence of an org filter is correct, not a
gap. **Flag — `DELETE /api/knowledge/documents/[id]`** ([#121](#)):
because the base is global, any single logged-in user of any org
(including a `crew_member`) can permanently delete a document —
cascading its chunks and storage file — for *every* org on the platform.
This destructive cross-org action should sit behind an admin-class gate
(`adminOnly`, or a knowledge-management key if one is introduced). No
canonical key fits today, so it is **called out for follow-up**, not
changed here.

**notifications — ⚠️ flagged** ([#119](#)). `GET` and `PATCH
/api/notifications`. Notifications are per-user and not role-gated, so
"logged-in" is the right gate *class* — no permission key applies. But
both handlers trust a client-supplied identity: `GET` returns the
notifications of whatever `userId` query param is passed (Service
client, no caller check), and `PATCH` marks another user's notifications
read by `user_id`, or any notification read by row `id` with no
ownership check. This is a horizontal-privilege / IDOR gap, not a
missing rule — the fix is to derive the target from `ctx.userId` rather
than request input. **Called out for follow-up;** the logged-in gate
itself stays.

**Jarvis chat — ⚠️ flagged** ([#120](#)). `POST /api/jarvis/chat`.
Jarvis is a company-wide assistant — every member, crew included, is
expected to use it, and no key carves it by role — so logged-in-only is
the intended *auth* policy. But the handler queries org data with the
Service client and **no `organization_id` filter**: the general-context
"business snapshot" sums `jobs`, `invoices`, `payments`, and
`job_activities` **platform-wide** (active counts, total outstanding
balance, overdue counts) into the system prompt, and the job-context
branch loads a job by `job_id` alone. `ctx.orgId` is resolved but
unused, so Jarvis can surface another org's aggregate financials and an
arbitrary job. This is a cross-tenant data-scoping bug — the same class
as the [#79](#79--expenses-tracer) expenses gap — not a permission rule.
**Called out for follow-up:** scope every Jarvis query to `ctx.orgId`;
the tool executions in `@/lib/jarvis/tools` should be reviewed for the
same gap. (`jarvis/field-ops`/`marketing`/`rnd` are the custom-auth
department routes from the #85 special-case notes — out of #99 scope.)

**Summary.** marketing (6 endpoints) and knowledge search + reads (3):
logged-in-only confirmed. Three follow-ups recorded for separate slices —
knowledge `DELETE` ([#121](#)), notifications `GET`/`PATCH` ([#119](#)),
Jarvis chat ([#120](#)). #99 changed no code.

### #102 — payments

The four `payments` endpoints listed under [#83](#83--jobs--payments--payment-requests)
were logged-in-only. Tightened to canonical #96 keys:

- `GET /api/payments` → `{ permission: "view_billing" }` — listing payments
  is a billing-area read.
- `POST /api/payments` → `{ permission: "record_payments", serviceClient: true }`
- `PATCH /api/payments/[id]` → `{ permission: "record_payments", serviceClient: true }`
- `DELETE /api/payments/[id]` → `{ permission: "record_payments", serviceClient: true }`

`view_billing` and `record_payments` both already exist in
`PERMISSION_CATALOG` (group "Billing"); no new key was introduced. Admins
auto-pass a `permission` rule. A member lacking the key now gets 403 — the
wrapper rejects before the handler runs.

`POST /api/payments/[id]/retry-qb-sync` was already gated on
`record_payments` at conversion time and needed no change.

### #101 — expenses Service-client GETs org scoping

The four expenses GETs listed under [#79](#79--expenses-tracer) read through
the Service client (RLS bypassed) with **no Active-Organization filter**, so
any logged-in user could read another Organization's expense data by id:

- `GET /api/expenses/by-job/[jobId]`
- `GET /api/expenses/by-activity/[activityId]`
- `GET /api/expenses/[id]/thumbnail-url`
- `GET /api/expenses/[id]/receipt-url`

Each handler now calls the Active-Organization scoping guard
(`belongsToActiveOrganization`, #97) before the read and returns 404 when it
fails. The resource each guards is the id the route is *given*, so a
cross-Organization id is rejected before any of its data is touched:

- `by-job` → `{ jobId }` — the job's own `organization_id`.
- `by-activity` → `{ table: "job_activities", id }` — the activity, resolved
  to its job's `organization_id` through `job_activities.job_id`.
- `[id]/thumbnail-url`, `[id]/receipt-url` → `{ table: "expenses", id }` —
  the expense's own `organization_id`.

The guard's `RESOLVERS` map gained one entry — `expenses: directColumn(...)`
— since `expenses` carries its own `organization_id` column (`NOT NULL`
since build 45). `jobs` and `job_activities` were already registered by #97.

This is a data-scoping correctness fix only; it adds no permission gate. A
resource in another Organization is now indistinguishable from a missing one
— both return 404 — and behavior is unchanged for resources in the caller's
own Active Organization.
