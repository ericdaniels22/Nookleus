# Org-wide email-template authorization is enforced in RLS, not only the app

**Status:** Accepted
**Date:** 2026-06-15 (issue #658, M4 — child of security PRD #634)

## Context

`email_templates` (migration-572) has two scopes, keyed by a nullable
`owner_user_id`: **org-wide** (`NULL`, shared — every member reads it) and
**personal** (`= user`, private). The intended write rule is that creating,
editing, or deleting an **org-wide** template requires the granular
`manage_email_templates` permission (role `admin` auto-passes), while a
personal template is always its owner's to manage. That rule lived **only** in
the app layer (`authorizeTemplateMutation` → `evaluatePermissionRule`), because
Nookleus' granular grants live in our own tables (`user_organization_permissions`),
not in the Supabase JWT, so the original RLS policy could not see them.

Migration-572's single `FOR ALL` policy therefore gated org-wide rows on
`nookleus.is_member_of()` **alone** — pure org membership, no role/permission
predicate. Its `USING` and `WITH CHECK` were identical.

That left a backstop gap: a direct PostgREST call (an authenticated member's
own token, bypassing the Next.js route and its app gate) could create, edit, or
delete org-wide shared templates. Issue #658's Part 1 (server-side HTML
sanitization) closed the XSS-on-send vector and the compose preview routes
template bodies through the Tiptap parser, so the residual was primarily an
**authorization-integrity** gap — an unprivileged member silently vandalising,
impersonating, or deleting *shared* org templates.

We confirmed the gap empirically with a **live, rolled-back adversarial RLS
probe against production** (2026-06-15): simulating a `crew_lead` member with no
`manage_email_templates` grant (`SET ROLE authenticated` + that member's JWT
claims), a direct `INSERT` of an org-wide template **succeeded**. The probe ran
inside a `DO` block that always raises, so nothing persisted (verified: zero
residual rows).

The options weighed (issue #658 M4):
- **A — DB role/grant predicate (chosen):** tighten RLS so it enforces the same
  rule as the app. Defense-in-depth, matching the PRD #634 ethos and
  migration-572's own "RLS is the data-isolation backstop" framing.
- **B — accept app-gate + sanitization, document residual:** no DB change,
  justified by no real customers on prod yet. Rejected: the integrity gap is a
  silent, member-reachable mutation of shared data, and we are still
  pre-customer (cheapest possible time to harden).

## Decision

1. **RLS is a true authorization backstop for org-wide template writes**, not
   merely data isolation. The app-layer gate stays (it returns clean 403s and
   is the primary UX path); RLS now enforces the *same* rule independently, so a
   direct DB call cannot bypass it.

2. **The role/grant check is a `SECURITY DEFINER` helper**,
   `nookleus.can_manage_email_templates(target_org uuid)`, mirroring
   `authorizeTemplateMutation` exactly: role `admin` **or** a granted
   `manage_email_templates` permission. It is `SECURITY DEFINER` (like
   `is_member_of`) so the policy never recurses into `user_organizations` /
   `user_organization_permissions` RLS — the recursion hazard that previously
   bit the phone-event policies (#313). A membership/grant lookup must not be
   filtered by the caller's own row visibility.

3. **The policy is split into per-command policies** (migration-658), because a
   single `FOR ALL` policy shares one `USING` clause between `SELECT` and
   `DELETE` — tightening it to gate deletes would also hide org-wide templates
   from members. `SELECT` keeps migration-572's visibility verbatim; `INSERT`
   (`WITH CHECK`), `UPDATE` (`USING` + `WITH CHECK`), and `DELETE` (`USING`) all
   apply the write predicate: `owner_user_id = auth.uid()` **or**
   (`owner_user_id IS NULL` **and** `can_manage_email_templates(org)`). The
   `UPDATE USING` clause also prevents an unprivileged member from targeting an
   org-wide row to "convert" it into a personal row it would then own.

4. **Validated live, before and after.** Same prod adversarial probe re-run
   post-migration: the unprivileged `crew_lead` is now **denied** org-wide
   `INSERT`/`UPDATE`/`DELETE`; an `admin` and a (synthetic, rolled-back)
   grant-holder are still **allowed** (no false-deny); members still **read**
   org-wide templates (no visibility regression). App-layer 403s are unchanged.

## Consequences

- A correlated lookup runs on each org-wide template write (rare, low-volume
  Settings action) — negligible cost; the helper is `STABLE`.
- The rule now lives in **two** places (app + DB) and must stay in sync. They
  are intentionally identical; if the app gate's role/grant logic changes,
  `can_manage_email_templates` must change with it. Both are covered by tests
  (`authorize-template-mutation.test.ts`, the route tests, and the recorded
  adversarial probe).
- Personal templates and org-wide *visibility* are unaffected.
- This pattern (SECURITY DEFINER grant helper + per-command policies) is the
  template for any future feature whose JWT-absent granular grant needs a DB
  backstop.
