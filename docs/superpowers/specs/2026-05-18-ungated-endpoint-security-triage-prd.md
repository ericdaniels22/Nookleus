# PRD: Security triage of the ungated (logged-in-only) endpoints

> Tracking issue: #95 · Parent (delivered): #78 — Request Context wrapper
> Inventory: `docs/request-context-ungated-endpoints.md`

## Problem Statement

A Nookleus Organization owner expects that the people they invite into their
company can only do what their role allows, and that nothing they do can
reach another company's data. Today neither holds for a large class of API
endpoints.

PRD #78 converted every API route onto the `withRequestContext` wrapper, but
deliberately preserved behavior: any endpoint that had no permission gate
before was wrapped **logged-in-only**. Slice #86 inventoried the result —
roughly 95 endpoints that any authenticated member of any Organization can
call, regardless of role. Concretely, today:

- Any logged-in member can invite users, change roles, ban accounts, and
  **rewrite another member's permission grants** — a non-admin can grant
  themselves every permission via `PUT /api/settings/users/[id]/permissions`.
- Any logged-in user can read another Organization's job expenses by job id
  (`GET /api/expenses/by-job/[jobId]` reads through the Service client,
  which bypasses row-level security, with no Active-Organization filter).
- Any logged-in user can read and soft-archive **another Organization's**
  contract templates by id (`GET`/`DELETE /api/settings/contract-templates/[id]`
  omit the organization filter their sibling `PATCH` applies).
- Dozens of further endpoints (job files, payments, intake-form, email,
  catalogs, the settings CSV export) enforce no role or permission at all.

The Organization owner needs each endpoint to enforce the access policy they
actually intend, and every cross-Organization data path closed.

## Solution

Triage every endpoint on the published ungated-endpoint list. For each one,
make and record an explicit decision: either confirm logged-in-only is
correct (with the reason), or tighten it to the appropriate permission rule.
Separately — and independent of any permission decision — close the
cross-Organization data-scoping holes, because a missing Organization filter
is a leak no permission rule fixes.

The work splits into two tiers so the urgent fixes are not blocked behind the
broad policy pass:

- **Tier 1 — concrete fixes.** The ⚠️ items: a reusable Active-Organization
  scoping guard, the `settings/users/*` gating, and the `contract-templates`
  and `expenses` Organization-scoping holes. Each has a clear right answer
  and needs no product debate.
- **Tier 2 — policy triage.** A per-feature-area pass that assigns each
  remaining logged-in-only endpoint its intended permission rule (or confirms
  logged-in-only), driven by a single canonical permission-key vocabulary.

This PRD is written to be sliced by `/to-issues` into tracer-bullet vertical
slices: the guard module is the tracer, then each ⚠️ fix and each feature
area is an independently-grabbable slice.

## User Stories

1. As an Organization owner, I want only admins to invite new users, so that a crew member cannot expand my team without my involvement.
2. As an Organization owner, I want only admins to change a member's role, so that a crew member cannot promote themselves.
3. As an Organization owner, I want only admins to rewrite a member's permission grants, so that no one can self-grant privileges they were not given.
4. As an Organization owner, I want only admins to deactivate or ban a member account, so that account access is not removed by an unauthorized teammate.
5. As an Organization owner, I want the member list and a member's permission grants readable only by admins, so that the org's access configuration is not exposed to every logged-in user.
6. As an Organization owner, I want my contract templates invisible to users of other companies, so that my business documents stay private.
7. As an Organization owner, I want my contract templates un-archivable by users of other companies, so that another company cannot disrupt my contract workflow.
8. As an Organization owner, I want a job's expenses readable only by members of the Organization that owns the job, so that my financial data does not leak across tenants.
9. As an Organization owner, I want an activity's expenses and an expense's receipt/thumbnail URLs reachable only within the owning Organization, so that no expense data path bypasses tenant scoping.
10. As a developer, I want one reusable, isolately-testable guard that answers "does this resource belong to the Active Organization," so that every Service-client route scopes the same way instead of re-implementing filters by hand.
11. As a developer, I want a single canonical list of permission keys, so that route gates and the permission-management UI reference the same vocabulary and no rule names a key that does not exist.
12. As an Organization owner, I want recording, updating, and deleting a payment to require the `record_payments` permission, so that crew members without billing duties cannot alter money records.
13. As an Organization owner, I want listing payments to require a billing-view permission, so that payment history is not visible to every member.
14. As an Organization owner, I want uploading, renaming, and deleting a job's files and photos to require a job-edit permission, so that job documentation is not changed by members without job-edit rights.
15. As an Organization owner, I want job search to require a job-view permission, so that the job list is not enumerable by members without job access.
16. As an Organization owner, I want voiding an invoice or marking it sent to require an invoice-management permission, so that invoice state changes match the existing invoice gates.
17. As an Organization owner, I want sending, voiding, deleting, restoring, resending, and reminding on contracts to require an appropriate permission, so that contract actions are not available to every member.
18. As an Organization owner, I want changing company, appearance, and branding settings to require `access_settings`, so that only settings-managers can rebrand the company.
19. As an Organization owner, I want the job-status and damage-type catalogs editable only with `access_settings`, so that shared catalogs are not changed by arbitrary members.
20. As an Organization owner, I want intake-form configuration and version restore to require `access_settings`, so that the company's intake form is not reconfigured by unauthorized members.
21. As an Organization owner, I want the settings CSV export — which dumps jobs, contacts, payments, invoices, emails, and activities — gated, so that the company's full dataset is not exportable by every logged-in user.
22. As an Organization owner, I want reading and updating email messages, threads, drafts, and sending email gated on email permissions, so that mailbox access matches the existing `view_email` / `send_email` vocabulary.
23. As an Organization owner, I want connecting, updating, and disconnecting email accounts gated, so that account connections are managed deliberately.
24. As a developer, I want every endpoint on the inventory to carry a recorded triage decision, so that "logged-in-only" is always a deliberate choice and never an oversight.
25. As a developer, I want endpoints whose intended policy is genuinely logged-in-only to stay `{}`-wrapped with the reason recorded, so that the triage is auditable and not a blanket tightening.
26. As a developer, I want the highest-risk tightened routes covered by tests, so that a future change cannot silently re-open the gap.
27. As an Organization owner, I want the triage to change no behavior for endpoints already correctly gated, so that the existing role/permission experience is undisturbed.

## Implementation Decisions

### Tier 1 — concrete fixes

**Active-Organization scoping guard (new deep module).** Add a small,
isolately-testable guard that answers a single question: does a given
resource belong to the caller's Active Organization. It is the counterpart,
for Service-client routes, of what row-level security gives User-client
routes for free. Proposed interface: a function that takes a database client,
a resource locator (table + id, or a job id), and the Active Organization id,
and resolves to a boolean. Routes call it and return 404 (not 403 — do not
confirm the resource exists) when it fails. Resources reached indirectly
(an activity → its job → its Organization) may need a per-table resolver
inside the module; the public interface stays a single boolean question.
Consumers: `expenses/by-job/[jobId]`, `expenses/by-activity/[activityId]`,
`expenses/[id]/thumbnail-url`, `expenses/[id]/receipt-url`, and
`contracts/by-job/[jobId]`.

**`settings/users/*` gating.** All five endpoints (`GET`/`POST /users`,
`PATCH /users/[id]`, `GET`/`PUT /users/[id]/permissions`) change from `{}`
to an admin-class rule. Decision: gate on `{ permission: "access_settings" }`
— consistent with the rest of `settings/*` and with `stripe/settings`, which
already uses `access_settings`. The `serviceClient: true` opt-in stays. (An
`adminOnly` rule was considered; `access_settings` is preferred so the
permission-management UI can delegate settings administration without
granting full admin.)

**`contract-templates/[id]` Organization scoping.** `GET` and `DELETE` add
the `.eq("organization_id", ctx.orgId)` filter their sibling `PATCH` already
has — a not-found resource and a wrong-Organization resource both return 404.
This is a correctness fix applied regardless of the permission decision; the
permission rule for these routes is set in the Tier 2 `settings` pass.

**`expenses/by-job` and siblings.** The four expenses Service-client GETs
call the new guard before reading, so a job id from another Organization
returns 404 instead of that Organization's expense rows.

### Permission-key vocabulary (precondition for Tier 2)

The permission vocabulary is fragmented. `settings/users/route.ts` seeds 13
keys (`view_jobs`, `access_settings`, `record_payments`, …), but gated route
handlers already reference keys absent from that list — `view_invoices`,
`create_invoices`, `edit_invoices`, `manage_invoices`, `view_estimates`,
`create_estimates`, `edit_estimates`, `convert_estimates`, `manage_templates`,
`view_accounting`, `log_expenses`. Before Tier 2 maps endpoints onto keys,
establish one canonical permission-key set as the single source of truth,
reconcile the `settings/users` seed list against it, and confirm every key a
rule references actually exists. New keys are introduced only if an area
genuinely has no fitting key (e.g. contracts) — and that is itself a recorded
decision.

### Tier 2 — per-area policy mapping

Each feature area below is one vertical slice: assign every listed endpoint
its rule, apply it, and record the decision in the triage doc. Proposed
default rules (final call belongs to each slice):

- **payments** — mutations (`POST`/`PATCH`/`DELETE`) → `record_payments`;
  `GET` list → a billing-view key.
- **jobs files & photos** — reads → a job-view key; writes/deletes → a
  job-edit key. **`jobs/search`** → a job-view key.
- **invoices `void` / `mark-sent`** — match the existing invoice gates
  (`manage_invoices` / `edit_invoices`).
- **contracts** (`send`, `preflight`, `in-person*`, `void`, delete, restore,
  resend, remind, pdf, `by-job`) — needs a contract-area key decision; no
  contract permission key exists today.
- **settings** (intake-form, company, appearance, branding, statuses,
  damage-types, contract-email, signatures, contract-templates, export,
  nav-order read) → `access_settings`. The `export` route, which dumps the
  whole dataset, is explicitly confirmed as `access_settings`-or-stricter.
- **email** content + accounts → `view_email` / `send_email`.
- **marketing, knowledge, notifications, Jarvis chat** — no permission key
  exists; default is to confirm logged-in-only with the reason recorded,
  unless a slice argues otherwise.

### Recording decisions

Every endpoint's outcome — tightened (to which rule) or confirmed
logged-in-only (why) — is recorded back into
`docs/request-context-ungated-endpoints.md` (or a sibling decisions doc), so
the inventory becomes a closed, audited ledger.

## Testing Decisions

A good test here exercises externally observable access behavior — a request
with a given identity is allowed or denied — never the internals of how a
rule is evaluated.

- **Unit-test the Active-Organization scoping guard in isolation.** It is the
  one new deep module: a resource in the Active Organization passes, a
  resource in another Organization is denied, a missing resource is denied.
  Prior art: `evaluate-permission-rule.test.ts` (pure, fake-free) and the
  fake-client pattern in `with-request-context.test.ts` /
  `require-page-permission.test.ts`.
- **Integration-test the highest-risk tightened routes.** At minimum: a
  non-admin is denied `PUT /api/settings/users/[id]/permissions`, and a
  cross-Organization job id is rejected by `GET /api/expenses/by-job/[jobId]`.
  Prior art: the `item-library` route tests.
- The bulk Tier 2 rule changes are not individually unit-tested; they reuse
  the already-tested `withRequestContext` + `evaluatePermissionRule` path.
  A slice may add a test where a rule choice is non-obvious.
- The permission-key vocabulary is reconciled and reviewed, not unit-tested
  (a sync test was considered and rejected as gold-plating).

## Out of Scope

- **Custom-auth routes**, deliberately left unwrapped by PRD #78 and not part
  of this triage: `jarvis/field-ops`, `jarvis/marketing`, `jarvis/rnd`,
  `knowledge/ingest` (session cookie or `x-service-key`), `stripe/webhook`
  (signature), `qb/callback` (OAuth redirect), `qb/sync-scheduled`
  (`CRON_SECRET`).
- **Row-level security policy changes.** The guard scopes Service-client
  reads in application code; rewriting Postgres RLS policies is separate work.
- **Retiring the legacy `user_permissions` table.** `settings/users` still
  dual-writes it; that deprecation is out of scope.
- **Permission-management UI changes** beyond reconciling the seed key list.
- Endpoints already carrying a real rule (the `#82` accounting/QuickBooks
  routes, item-library, estimate-templates, etc.) — untouched.

## Further Notes

- The cross-Organization holes (`expenses`, `contract-templates`) are
  data-scoping bugs, not missing permissions. They must be fixed even where
  the permission decision lands on logged-in-only.
- `contract-templates/[id]` GET/DELETE use the **User client**, so RLS may
  already constrain them; the explicit `organization_id` filter is
  defense-in-depth and matches the sibling `PATCH`. The `expenses` routes use
  the **Service client**, which bypasses RLS — those are the confirmed leaks.
- This PRD will be decomposed by `/to-issues`. The guard module is the
  natural tracer-bullet slice; Tier 1 fixes and each Tier 2 feature area are
  independently-grabbable slices that depend only on the guard and the
  permission-key vocabulary slices.
