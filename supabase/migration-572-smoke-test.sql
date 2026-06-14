-- issue #639 (PRD #634) — email_templates RLS smoke test.
--
-- Purpose:   Verify that migration-572 produced the expected post-state and,
--            above all, pins the testable core of the slice — the visibility
--            rule: "a Request Context can read Organization-wide templates
--            for its Active Organization plus its own Personal templates —
--            never another user's Personal templates, never another
--            Organization's templates."
--
-- Shape:     One transaction, rolled back at the end. Seeds 2 orgs + 3 users
--            (admin org1, crew_lead org1, admin org2) under service-role
--            bypass, asserts the column shape, then walks the RLS matrix
--            under `role authenticated`:
--              SELECT (the core) — each caller sees exactly Org-wide(own org)
--                                  + own Personal; never another user's
--                                  Personal, never another org's rows.
--              INSERT (backstop) — Org-wide by a member allowed (incl. a
--                                  non-admin: RLS does NOT gate the
--                                  `manage_email_templates` permission — the
--                                  app layer does); Personal-self allowed;
--                                  Personal-other denied; cross-org denied.
--
-- Run:       Via Supabase MCP `execute_sql` against the target project. Once
--            applied to prod, this script remains as the documented test of
--            the policy. Not run by CI.
--
-- IDs:       Prefix `43` keeps these seeds distinct from migration-140 (`40`),
--            migration-222 (`41`), and migration-307 (`42`).

begin;

-- ---------------------------------------------------------------------------
-- 0. Seed. Service-role bypass for orgs / users / memberships.
--      Org 1: smoke-572-org-1   — User A (admin), User B (crew_lead)
--      Org 2: smoke-572-org-2   — User C (admin)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('43000000-0000-0000-0000-000000000001', 'smoke-572-org-1', 'smoke-572-org-1'),
  ('43000000-0000-0000-0000-000000000002', 'smoke-572-org-2', 'smoke-572-org-2');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('43000000-0000-0000-0000-000000000010', 'smoke-572-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('43000000-0000-0000-0000-000000000011', 'smoke-572-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('43000000-0000-0000-0000-000000000012', 'smoke-572-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('43000000-0000-0000-0000-000000000010', '43000000-0000-0000-0000-000000000001', 'admin'),
  ('43000000-0000-0000-0000-000000000011', '43000000-0000-0000-0000-000000000001', 'crew_lead'),
  ('43000000-0000-0000-0000-000000000012', '43000000-0000-0000-0000-000000000002', 'admin');

-- ---------------------------------------------------------------------------
-- 1. Column-shape assertions. Pin the discriminator: organization_id NOT
--    NULL, owner_user_id nullable. A future schema drift that flips either
--    breaks the Org-wide/Personal split and must fail loudly here.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_nullable text;
  v_owner_nullable text;
begin
  select is_nullable into v_org_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'email_templates'
     and column_name = 'organization_id';
  select is_nullable into v_owner_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'email_templates'
     and column_name = 'owner_user_id';

  if v_org_nullable is distinct from 'NO' then
    raise exception 'migration-572 smoke (shape): organization_id must be NOT NULL, got is_nullable=%', v_org_nullable;
  end if;
  if v_owner_nullable is distinct from 'YES' then
    raise exception 'migration-572 smoke (shape): owner_user_id must be nullable, got is_nullable=%', v_owner_nullable;
  end if;
  raise notice 'migration-572 smoke (shape): organization_id NOT NULL + owner_user_id nullable confirmed';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Seed templates under service-role bypass (RLS exercised in §3-4):
--      T1 — org1 Organization-wide   (owner NULL)
--      T2 — org1 Personal-by-A
--      T3 — org1 Personal-by-B
--      T4 — org2 Organization-wide   (owner NULL)
--      T5 — org2 Personal-by-C
-- ---------------------------------------------------------------------------
insert into public.email_templates
  (id, organization_id, owner_user_id, name, body_html, created_by)
values
  ('43000000-0000-0000-0000-000000000101', '43000000-0000-0000-0000-000000000001', null,
   'org1 shared', '<p>org1 shared</p>', '43000000-0000-0000-0000-000000000010'),
  ('43000000-0000-0000-0000-000000000102', '43000000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000010',
   'A personal', '<p>A personal</p>', '43000000-0000-0000-0000-000000000010'),
  ('43000000-0000-0000-0000-000000000103', '43000000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000011',
   'B personal', '<p>B personal</p>', '43000000-0000-0000-0000-000000000011'),
  ('43000000-0000-0000-0000-000000000104', '43000000-0000-0000-0000-000000000002', null,
   'org2 shared', '<p>org2 shared</p>', '43000000-0000-0000-0000-000000000012'),
  ('43000000-0000-0000-0000-000000000105', '43000000-0000-0000-0000-000000000002', '43000000-0000-0000-0000-000000000012',
   'C personal', '<p>C personal</p>', '43000000-0000-0000-0000-000000000012');

-- ---------------------------------------------------------------------------
-- 3. SELECT RLS — the testable core. Each caller sees exactly Org-wide(own
--    org) + own Personal.
-- ---------------------------------------------------------------------------

-- 3a. As admin A (org1): sees T1 (org-wide org1) + T2 (own personal). Does
--     NOT see T3 (B's personal), T4 / T5 (org2).
do $$
declare
  v_count bigint;
  v_ids uuid[];
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"43000000-0000-0000-0000-000000000010","active_organization_id":"43000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), array_agg(id order by id) into v_count, v_ids
    from public.email_templates;

  reset role;

  if v_count <> 2 then
    raise exception 'migration-572 smoke (3a): admin A expected 2 rows (org-wide + own personal), got % — ids=%', v_count, v_ids;
  end if;
  if not (v_ids @> array['43000000-0000-0000-0000-000000000101'::uuid, '43000000-0000-0000-0000-000000000102'::uuid]) then
    raise exception 'migration-572 smoke (3a): admin A rows wrong — expected T1 (..101) + T2 (..102), got %', v_ids;
  end if;
  raise notice 'migration-572 smoke (3a): admin A correctly sees org-wide + own personal only';
end $$;

-- 3b. As crew_lead B (org1): sees T1 (org-wide) + T3 (own personal). Does
--     NOT see T2 (A's personal) — another user's Personal is invisible even
--     within the same org.
do $$
declare
  v_count bigint;
  v_ids uuid[];
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"43000000-0000-0000-0000-000000000011","active_organization_id":"43000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), array_agg(id order by id) into v_count, v_ids
    from public.email_templates;

  reset role;

  if v_count <> 2 then
    raise exception 'migration-572 smoke (3b): crew_lead B expected 2 rows (org-wide + own personal), got % — ids=%', v_count, v_ids;
  end if;
  if not (v_ids @> array['43000000-0000-0000-0000-000000000101'::uuid, '43000000-0000-0000-0000-000000000103'::uuid]) then
    raise exception 'migration-572 smoke (3b): crew_lead B rows wrong — expected T1 (..101) + T3 (..103), got %', v_ids;
  end if;
  raise notice 'migration-572 smoke (3b): crew_lead B sees org-wide + own personal, not A''s personal';
end $$;

-- 3c. As admin C (org2): sees T4 (org-wide org2) + T5 (own personal). Org1
--     is entirely invisible — never another Organization's rows.
do $$
declare
  v_count bigint;
  v_ids uuid[];
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"43000000-0000-0000-0000-000000000012","active_organization_id":"43000000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*), array_agg(id order by id) into v_count, v_ids
    from public.email_templates;

  reset role;

  if v_count <> 2 then
    raise exception 'migration-572 smoke (3c): admin C expected 2 rows (org2 org-wide + own personal), got % — ids=%', v_count, v_ids;
  end if;
  if not (v_ids @> array['43000000-0000-0000-0000-000000000104'::uuid, '43000000-0000-0000-0000-000000000105'::uuid]) then
    raise exception 'migration-572 smoke (3c): admin C rows wrong — expected T4 (..104) + T5 (..105), got %', v_ids;
  end if;
  raise notice 'migration-572 smoke (3c): admin C sees only its own org';
end $$;

-- ---------------------------------------------------------------------------
-- 4. INSERT RLS — the data-isolation backstop. RLS allows any member to
--    write Org-wide (the `manage_email_templates` permission is enforced in
--    the app layer, NOT here), allows Personal-self, and denies
--    Personal-other and cross-org.
-- ---------------------------------------------------------------------------

-- 4a. admin A inserts Org-wide in own org → allowed.
do $$
declare v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"43000000-0000-0000-0000-000000000010","active_organization_id":"43000000-0000-0000-0000-000000000001","role":"authenticated"}';
  begin
    insert into public.email_templates (organization_id, owner_user_id, name, body_html)
    values ('43000000-0000-0000-0000-000000000001', null, 'A org-wide insert', '<p>x</p>');
  exception when insufficient_privilege then v_blocked := true;
  end;
  reset role;
  if v_blocked then
    raise exception 'migration-572 smoke (4a): admin Org-wide INSERT should be allowed, but RLS blocked it';
  end if;
  raise notice 'migration-572 smoke (4a): admin Org-wide INSERT correctly allowed';
end $$;

-- 4b. crew_lead B (non-admin) inserts Org-wide in own org → allowed at RLS.
--     This documents the defense-in-depth split: RLS does NOT gate the
--     `manage_email_templates` permission — the app layer (the CRUD route's
--     authorizeTemplateMutation) does. A non-admin without the permission is
--     stopped one layer up, not here.
do $$
declare v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"43000000-0000-0000-0000-000000000011","active_organization_id":"43000000-0000-0000-0000-000000000001","role":"authenticated"}';
  begin
    insert into public.email_templates (organization_id, owner_user_id, name, body_html)
    values ('43000000-0000-0000-0000-000000000001', null, 'B org-wide insert', '<p>x</p>');
  exception when insufficient_privilege then v_blocked := true;
  end;
  reset role;
  if v_blocked then
    raise exception 'migration-572 smoke (4b): non-admin Org-wide INSERT should pass RLS (permission is app-layer), but RLS blocked it';
  end if;
  raise notice 'migration-572 smoke (4b): non-admin Org-wide INSERT correctly passes RLS (permission gate is app-layer)';
end $$;

-- 4c. crew_lead B inserts Personal owned by themselves → allowed.
do $$
declare v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"43000000-0000-0000-0000-000000000011","active_organization_id":"43000000-0000-0000-0000-000000000001","role":"authenticated"}';
  begin
    insert into public.email_templates (organization_id, owner_user_id, name, body_html)
    values ('43000000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000011', 'B personal insert', '<p>x</p>');
  exception when insufficient_privilege then v_blocked := true;
  end;
  reset role;
  if v_blocked then
    raise exception 'migration-572 smoke (4c): Personal-self INSERT should be allowed, but RLS blocked it';
  end if;
  raise notice 'migration-572 smoke (4c): Personal-self INSERT correctly allowed';
end $$;

-- 4d. crew_lead B inserts Personal owned by ANOTHER user (A) → denied.
--     Neither WITH CHECK branch passes: owner_user_id is not NULL (Org-wide
--     branch fails) and owner_user_id != auth.uid() (Personal branch fails).
do $$
declare v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"43000000-0000-0000-0000-000000000011","active_organization_id":"43000000-0000-0000-0000-000000000001","role":"authenticated"}';
  begin
    insert into public.email_templates (organization_id, owner_user_id, name, body_html)
    values ('43000000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000010', 'B steals A', '<p>x</p>');
  exception when insufficient_privilege then v_blocked := true;
  end;
  reset role;
  if not v_blocked then
    raise exception 'migration-572 smoke (4d): Personal-owned-by-other INSERT should be denied, but it succeeded';
  end if;
  raise notice 'migration-572 smoke (4d): Personal-owned-by-other INSERT correctly denied';
end $$;

-- 4e. admin C (org2) inserts into org1 → denied (cross-org). WITH CHECK
--     requires organization_id = active org, and C's active org is org2.
do $$
declare v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"43000000-0000-0000-0000-000000000012","active_organization_id":"43000000-0000-0000-0000-000000000002","role":"authenticated"}';
  begin
    insert into public.email_templates (organization_id, owner_user_id, name, body_html)
    values ('43000000-0000-0000-0000-000000000001', null, 'C cross-org', '<p>x</p>');
  exception when insufficient_privilege then v_blocked := true;
  end;
  reset role;
  if not v_blocked then
    raise exception 'migration-572 smoke (4e): cross-org INSERT should be denied, but it succeeded';
  end if;
  raise notice 'migration-572 smoke (4e): cross-org INSERT correctly denied';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Done. Roll back so the seed leaves no residue. A clean run prints only
--    the NOTICE lines above; a failure aborts earlier with a labeled
--    exception.
-- ---------------------------------------------------------------------------
rollback;
