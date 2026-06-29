-- issue #604 (parent PRD #603) — Google reviews inbox smoke test.
--
-- Purpose:   Self-checking script that verifies migration-604's schema
--            invariants and RLS. NOT part of the migration. Wrapped in
--            begin; ... rollback; so the database is unchanged on a clean run.
--            Every assertion raises on failure; a clean run prints only NOTICE
--            lines.
--
-- Preconditions: migration-604 has been applied. The admin-allow section needs
--            a real auth.users row and skips itself if the database has none;
--            every other section runs unconditionally.
--
-- Run:       psql -f supabase/migration-604-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. Table exists with every expected column.
--   2. star_rating accepts 0..5 and rejects out-of-range; the reply-consistency
--      CHECK rejects an unreplied row that carries reply text but allows a
--      replied row with no stored reply text.
--   3. Idempotent upsert on (organization_id, google_review_id): re-upserting
--      the same review updates it in place (one row, state advanced), and a
--      plain second INSERT for that pair is rejected.
--   4. RLS is enabled and carries an admin-only org-isolation policy.
--   5. RLS behaviour: a cross-Organization INSERT is denied.
--   6. RLS behaviour: a non-admin member is denied read+write; an admin member
--      sees and can write the row (skipped if no auth.users row exists).

begin;

-- ---------------------------------------------------------------------------
-- 1. Table and key columns exist.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg('google_review.' || col, ', ')
    into v_missing
  from unnest(array[
    'id', 'organization_id', 'google_review_id', 'location_name',
    'reviewer_name', 'reviewer_photo_url', 'star_rating', 'comment',
    'review_created_at', 'review_updated_at', 'replied', 'reply_comment',
    'reply_updated_at', 'created_at', 'updated_at'
  ]) as col
  where not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'google_review'
       and column_name = col
  );

  if v_missing is not null then
    raise exception 'migration-604 smoke: missing column(s): %', v_missing;
  end if;
  raise notice 'migration-604 smoke: table + columns present';
end $$;

-- ---------------------------------------------------------------------------
-- 2. star_rating range check + reply-consistency check.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name, slug)
    values (v_org_id, 'm604 smoke', 'm604-smoke-' || replace(v_org_id::text, '-', ''));

  -- ----- star_rating range -----
  begin
    insert into public.google_review (organization_id, google_review_id, location_name, star_rating)
      values (v_org_id, 'bad-star', 'accounts/1/locations/2', 6);
    raise exception 'm604 smoke: star_rating accepted out-of-range value 6';
  exception when check_violation then null;
  end;

  -- 0 (unspecified) and 5 are both valid.
  insert into public.google_review (organization_id, google_review_id, location_name, star_rating)
    values (v_org_id, 'star-0', 'accounts/1/locations/2', 0);
  insert into public.google_review (organization_id, google_review_id, location_name, star_rating)
    values (v_org_id, 'star-5', 'accounts/1/locations/2', 5);
  raise notice 'm604 smoke: star_rating — accepts 0..5, rejects 6';

  -- ----- reply consistency: unreplied row may NOT carry reply text -----
  begin
    insert into public.google_review
      (organization_id, google_review_id, location_name, replied, reply_comment)
      values (v_org_id, 'inconsistent', 'accounts/1/locations/2', false, 'stale reply');
    raise exception 'm604 smoke: an UNREPLIED row was allowed to carry reply_comment';
  exception when check_violation then null;
  end;

  -- ----- reply consistency is one-sided: a replied row with no stored text is OK
  insert into public.google_review
    (organization_id, google_review_id, location_name, replied, reply_comment)
    values (v_org_id, 'replied-no-text', 'accounts/1/locations/2', true, null);
  raise notice 'm604 smoke: reply-consistency — unreplied+text rejected, replied+no-text allowed';

  delete from public.google_review where organization_id = v_org_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Idempotent upsert on (organization_id, google_review_id).
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id  uuid := gen_random_uuid();
  v_count   bigint;
  v_replied boolean;
begin
  insert into public.organizations (id, name, slug)
    values (v_org_id, 'm604 upsert', 'm604-upsert-' || replace(v_org_id::text, '-', ''));

  -- First poll: an unreplied review.
  insert into public.google_review
    (organization_id, google_review_id, location_name, star_rating, replied)
    values (v_org_id, 'rev-1', 'accounts/1/locations/2', 5, false);

  -- Second poll: the owner has since replied. Re-upsert on the conflict target.
  insert into public.google_review
    (organization_id, google_review_id, location_name, star_rating, replied, reply_comment, reply_updated_at)
    values (v_org_id, 'rev-1', 'accounts/1/locations/2', 5, true, 'Thanks!', now())
  on conflict (organization_id, google_review_id) do update set
    replied          = excluded.replied,
    reply_comment    = excluded.reply_comment,
    reply_updated_at = excluded.reply_updated_at,
    star_rating      = excluded.star_rating;

  select count(*), bool_and(replied) into v_count, v_replied
    from public.google_review where organization_id = v_org_id;

  if v_count <> 1 then
    raise exception 'm604 smoke: re-upsert duplicated the review (% rows, expected 1)', v_count;
  end if;
  if not v_replied then
    raise exception 'm604 smoke: re-upsert did not advance replied state to true';
  end if;

  -- A plain second INSERT (no on conflict) for the same pair must be rejected.
  begin
    insert into public.google_review (organization_id, google_review_id, location_name)
      values (v_org_id, 'rev-1', 'accounts/1/locations/2');
    raise exception 'm604 smoke: uniq_google_review_org_review allowed a duplicate (org, review)';
  exception when unique_violation then null;
  end;
  raise notice 'm604 smoke: idempotent upsert — one row, state advanced, duplicate rejected';

  delete from public.google_review where organization_id = v_org_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RLS enabled + admin-only org-isolation policy present.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rls_on boolean;
  v_policy text;
begin
  select relrowsecurity into v_rls_on
    from pg_class where oid = 'public.google_review'::regclass;
  if not coalesce(v_rls_on, false) then
    raise exception 'm604 smoke: RLS is not enabled on google_review';
  end if;

  select string_agg(polname, ', ')
    into v_policy
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname = 'google_review'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%active_organization_id%'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%admin%';

  if v_policy is null then
    raise exception 'm604 smoke: google_review has no admin-only org-isolation RLS policy';
  end if;
  raise notice 'm604 smoke: RLS on; admin-only org-isolation policy present (%)', v_policy;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS behaviour — a cross-Organization INSERT is denied. The caller is
--    active in org B with a synthetic identity (no membership anywhere); the
--    proposed row belongs to org A. Both the org match and the admin EXISTS
--    fail, so the WITH CHECK denies it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_a   uuid := '60400000-0000-0000-0000-0000000000a1';
  v_org_b   uuid := '60400000-0000-0000-0000-0000000000b1';
  v_blocked boolean := false;
begin
  insert into public.organizations (id, name, slug) values
    (v_org_a, 'm604 rls A', 'm604-rls-a-' || replace(v_org_a::text, '-', '')),
    (v_org_b, 'm604 rls B', 'm604-rls-b-' || replace(v_org_b::text, '-', ''));

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"60400000-0000-0000-0000-0000000000f1","active_organization_id":"60400000-0000-0000-0000-0000000000b1","role":"authenticated"}';
  begin
    insert into public.google_review (organization_id, google_review_id, location_name)
      values (v_org_a, 'rev-x', 'accounts/1/locations/2');
  exception when insufficient_privilege then v_blocked := true;
  end;
  reset role;

  if not v_blocked then
    raise exception 'm604 smoke: cross-org INSERT into another Organization was NOT denied';
  end if;
  raise notice 'm604 smoke: RLS — cross-org INSERT denied';
end $$;

-- ---------------------------------------------------------------------------
-- 6. RLS behaviour — admin-only access. A non-admin member of the org is denied
--    both read and write; promoting them to admin lets them see and insert. The
--    membership EXISTS + auth.uid() need a real auth.users row, so this section
--    skips itself when the database has none.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org    uuid := '60400000-0000-0000-0000-0000000000a2';
  v_user   uuid;
  v_count  bigint;
  v_denied boolean := false;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then
    raise notice 'm604 smoke: admin-only RLS skipped — no auth.users row';
    return;
  end if;

  insert into public.organizations (id, name, slug)
    values (v_org, 'm604 admin', 'm604-admin-' || replace(v_org::text, '-', ''));

  -- Seed one review under owner bypass.
  insert into public.google_review (organization_id, google_review_id, location_name)
    values (v_org, 'seed', 'accounts/1/locations/2');

  -- The caller is a NON-admin member of the org.
  insert into public.user_organizations (user_id, organization_id, role)
    values (v_user, v_org, 'crew_member');

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'active_organization_id', v_org::text, 'role', 'authenticated')::text,
    true);

  -- Non-admin: sees nothing.
  select count(*) into v_count from public.google_review;
  if v_count <> 0 then
    reset role;
    raise exception 'm604 smoke: non-admin member saw % google_review rows (expected 0)', v_count;
  end if;
  -- Non-admin: cannot insert.
  begin
    insert into public.google_review (organization_id, google_review_id, location_name)
      values (v_org, 'nonadmin', 'accounts/1/locations/2');
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  if not v_denied then
    raise exception 'm604 smoke: non-admin member was allowed to INSERT a google_review';
  end if;

  -- Promote to admin: now visible.
  update public.user_organizations set role = 'admin'
    where user_id = v_user and organization_id = v_org;

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'active_organization_id', v_org::text, 'role', 'authenticated')::text,
    true);
  select count(*) into v_count from public.google_review;
  reset role;

  if v_count <> 1 then
    raise exception 'm604 smoke: admin member saw % google_review rows (expected 1)', v_count;
  end if;
  raise notice 'm604 smoke: RLS — non-admin denied read+write, admin sees the row';
end $$;

rollback;
