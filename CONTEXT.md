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

**Section**:
A top-level grouping inside an Estimate, Invoice, or Estimate template.
Has a title, a sort order, and directly contains zero or more Subsections
and/or Line items. Distinguished from a Subsection by having a null
parent reference.
_Avoid_: top-level section, group, category

**Subsection**:
A second-level grouping that lives inside one Section. One level deep
only — a Subsection cannot itself contain Subsections. Holds zero or
more Line items.
_Avoid_: nested section, child section, sub-group

**Line item**:
A single billable row — name, description, code, quantity, unit, unit
price, total. Belongs to exactly one Section or exactly one Subsection;
which one it belongs to is held in a single polymorphic reference, so a
Line item can be moved between any Section and any Subsection without
changing what kind of thing it is.
_Avoid_: line, item, row, entry

## Relationships

- A **User** belongs to one or more **Organizations**; each membership carries a role.
- A **Request Context** names exactly one **Active Organization**.
- A **Request Context** always carries a **User client**; it carries a **Service client** only when the route opts in.
- An **Email account** belongs to one **Organization**; a **Personal email account** is additionally owned by one **User**, a **Shared email account** by none.
- An **Outgoing email** belongs to one **Organization** and names exactly one **Email account** (the mailbox the document is sent from). There is one Outgoing email per document kind per Organization.
- A **Section** belongs to one Estimate, Invoice, or Estimate template; it directly contains zero or more **Subsections** and zero or more **Line items**.
- A **Subsection** belongs to exactly one **Section**; it directly contains zero or more **Line items**.
- A **Line item** belongs to exactly one **Section** or exactly one **Subsection** — never both, never neither.

## Example dialogue

> **Dev:** "When a route asks for a Request Context, does it always get a Service client?"
> **Maintainer:** "No — only the User client by default. The Service client bypasses Organization scoping, so a route has to explicitly opt in, and that opt-in is visible right at the route's declaration."

## Flagged ambiguities

- "auth gate" was used for four near-identical route helpers (`requirePermission`, `requireAdmin`, `requireViewAccounting`, and an inline `requireLogExpenses`) — resolved: these collapse into the one **Request Context** wrapper.
