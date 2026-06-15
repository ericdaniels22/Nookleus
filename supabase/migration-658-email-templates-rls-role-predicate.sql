-- migration-658-email-templates-rls-role-predicate.sql
-- ===========================================================================
-- Issue #658 (M4) — close the org-wide email-template authorization gap.
--
-- Background: migration-572 shipped email_templates with a single FOR ALL
-- policy whose USING and WITH CHECK both gated org-wide rows (owner_user_id
-- NULL) on nookleus.is_member_of() ALONE — pure org membership, no role or
-- permission predicate. The granular `manage_email_templates` grant lives in
-- our own tables (not the JWT), so migration-572 deferred that check to the
-- app layer (authorizeTemplateMutation). That left a backstop gap: any
-- authenticated member could create / edit / delete an ORG-WIDE shared
-- template via a direct PostgREST call, bypassing the app gate entirely.
-- Confirmed by a live, rolled-back adversarial RLS probe against prod
-- (2026-06-15): a crew_lead with no grant successfully inserted an org-wide
-- template at the DB layer.
--
-- Decision (ADR 0016): make RLS a true authorization backstop that mirrors
-- the app gate exactly — an org-wide write requires role 'admin' OR a granted
-- `manage_email_templates` permission; a personal template is always its
-- owner's. Visibility is UNCHANGED: every member still reads org-wide
-- templates.
--
-- Shape: a single FOR ALL policy cannot express this, because DELETE and
-- SELECT share one USING clause — tightening it to gate deletes would also
-- hide org-wide templates from members. So we split into per-command policies:
--   SELECT  — unchanged visibility (members read org-wide + own personal)
--   INSERT  — WITH CHECK: owner is self, OR org-wide AND caller can manage
--   UPDATE  — USING + WITH CHECK: same write predicate (USING also stops an
--             unprivileged member from targeting an org-wide row at all, so it
--             cannot be "converted" into a personal row it would then own)
--   DELETE  — USING: same write predicate
--
-- The role/grant check lives in a SECURITY DEFINER helper (like is_member_of)
-- so the policy never recurses into user_organizations /
-- user_organization_permissions RLS — the recursion hazard that bit the
-- phone-event policies (#313). SECURITY DEFINER bypassing RLS on the lookup is
-- correct here: a membership/grant lookup must not itself be filtered by the
-- caller's own row visibility.
--
-- Depends on: migration-572 (email_templates + the org_or_personal policy),
--             nookleus.active_organization_id(), nookleus.is_member_of(),
--             auth.uid().
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The role/permission helper — the one rule migration-572 left to the app.
--    Mirrors authorizeTemplateMutation + evaluatePermissionRule exactly: role
--    'admin' auto-passes; otherwise the caller's membership must hold a granted
--    `manage_email_templates` permission. SECURITY DEFINER + pinned search_path
--    so it reads the grant tables regardless of the caller's own RLS.
-- ---------------------------------------------------------------------------
create or replace function nookleus.can_manage_email_templates(target_org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.user_organizations uo
     where uo.user_id = auth.uid()
       and uo.organization_id = target_org
       and (
         uo.role = 'admin'
         or exists (
           select 1
             from public.user_organization_permissions p
            where p.user_organization_id = uo.id
              and p.permission_key = 'manage_email_templates'
              and p.granted
         )
       )
  );
$function$;

-- ---------------------------------------------------------------------------
-- 2. Replace the single org-or-personal policy with per-command policies.
-- ---------------------------------------------------------------------------
drop policy if exists email_templates_org_or_personal on public.email_templates;

-- SELECT — visibility is UNCHANGED from migration-572: a member reads every
-- org-wide template in the active org plus their own personal templates.
drop policy if exists email_templates_select on public.email_templates;
create policy email_templates_select on public.email_templates
  for select to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      (owner_user_id is null and nookleus.is_member_of(organization_id))
      or owner_user_id = auth.uid()
    )
  );

-- INSERT — a personal template is always the caller's to create; an org-wide
-- template requires the manage capability.
drop policy if exists email_templates_insert on public.email_templates;
create policy email_templates_insert on public.email_templates
  for insert to authenticated
  with check (
    organization_id = nookleus.active_organization_id()
    and (
      owner_user_id = auth.uid()
      or (owner_user_id is null
          and nookleus.can_manage_email_templates(organization_id))
    )
  );

-- UPDATE — USING decides which rows the caller may target; WITH CHECK decides
-- the post-image. Both apply the write predicate, so an unprivileged member can
-- neither edit an org-wide row nor convert one into a personal row it owns.
drop policy if exists email_templates_update on public.email_templates;
create policy email_templates_update on public.email_templates
  for update to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      owner_user_id = auth.uid()
      or (owner_user_id is null
          and nookleus.can_manage_email_templates(organization_id))
    )
  )
  with check (
    organization_id = nookleus.active_organization_id()
    and (
      owner_user_id = auth.uid()
      or (owner_user_id is null
          and nookleus.can_manage_email_templates(organization_id))
    )
  );

-- DELETE — USING is the only gate (no post-image); same write predicate.
drop policy if exists email_templates_delete on public.email_templates;
create policy email_templates_delete on public.email_templates
  for delete to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      owner_user_id = auth.uid()
      or (owner_user_id is null
          and nookleus.can_manage_email_templates(organization_id))
    )
  );

-- ROLLBACK ---
-- drop policy if exists email_templates_select on public.email_templates;
-- drop policy if exists email_templates_insert on public.email_templates;
-- drop policy if exists email_templates_update on public.email_templates;
-- drop policy if exists email_templates_delete on public.email_templates;
-- drop function if exists nookleus.can_manage_email_templates(uuid);
-- create policy email_templates_org_or_personal on public.email_templates
--   for all to authenticated
--   using (
--     organization_id = nookleus.active_organization_id()
--     and ((owner_user_id is null and nookleus.is_member_of(organization_id))
--          or owner_user_id = auth.uid())
--   )
--   with check (
--     organization_id = nookleus.active_organization_id()
--     and ((owner_user_id is null and nookleus.is_member_of(organization_id))
--          or owner_user_id = auth.uid())
--   );
