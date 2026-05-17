# Request Context — ungated-endpoint list

Running list of API endpoints that the Request Context conversion slices
(#80–#85) wrapped **logged-in-only** (`withRequestContext({}, …)`) because
they had **no permission gate at all** before the conversion.

The conversion is behavior-preserving by design (PRD #78): an endpoint with
no prior gate is wrapped logged-in-only, which matches its prior behavior —
it is **not** tightened here. This document is the deliverable that turns
"endpoints with no check" into a tracked, triageable list. **Tightening any
of these is a separate follow-up** — see #86, which publishes the final
version of this list.

Each slice appends its feature area below as it lands.

---

## #79 — expenses (tracer)

All wrapped `{ serviceClient: true }` (logged-in-only; Service client opt-in):

- `GET /api/expenses/by-job/[jobId]`
- `GET /api/expenses/by-activity/[activityId]`
- `GET /api/expenses/[id]/thumbnail-url`
- `GET /api/expenses/[id]/receipt-url`

The four `by-*` / `*-url` GETs additionally read expenses with the Service
client **without org-scoping** — a pre-existing data-scoping gap, flagged in
code comments for the triage follow-up.

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
