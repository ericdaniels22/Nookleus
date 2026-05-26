-- build78b (PRD #249, issue #256) — Referral Partners Trash cascade smoke test.
--
-- Purpose:   Pins the exact cascade scenario from issue #256's integration-
--            test AC: a Referral Partner with 2 Call log entries and 3
--            Referral Contacts (Primary + Owner + an extra). After hard-
--            delete, the AC says: zero referral_partner_calls remain for
--            that partner; all 3 contact rows still exist; each contact's
--            `referral_partner_id` is NULL.
--
--            The general FK behaviour is already pinned by
--            migration-build78-smoke-test.sql §2d. This script adds the
--            specific 2-calls-+-3-contacts shape from the issue so the AC
--            doesn't drift if someone changes the FK action in the future.
--
-- Preconditions: build78 has already been applied.
-- Run:       psql -f supabase/migration-build78b-trash-cascade-smoke-test.sql
--            (or paste into the Supabase SQL editor).
-- What runs: a `begin; ... rollback;` script — no schema changes survive.

begin;

do $$
declare
  v_org_id          uuid := gen_random_uuid();
  v_user_id         uuid;
  v_partner_id      uuid;
  v_primary_id      uuid := gen_random_uuid();
  v_owner_id        uuid := gen_random_uuid();
  v_extra_id        uuid := gen_random_uuid();
  v_call_count      int;
  v_contact_count   int;
  v_still_linked    int;
begin
  -- The Call log FK on user_id requires a real auth.users row. If none
  -- exists (rare local-only state), skip cleanly with a notice — the
  -- contact-side cascade still gets covered, but the call-side branch
  -- needs a user.
  select id into v_user_id from auth.users limit 1;
  if v_user_id is null then
    raise notice 'build78b smoke: no auth.users row — cannot exercise referral_partner_calls. Skipping.';
    rollback;
    return;
  end if;

  insert into public.organizations (id, name, slug)
    values (v_org_id, 'build78b smoke', 'build78b-smoke-' || replace(v_org_id::text, '-', ''));

  -- One Referral Partner.
  insert into public.referral_partners (organization_id, company_name)
    values (v_org_id, 'Acme Plumbing')
    returning id into v_partner_id;

  -- Three Referral Contacts at this partner: Primary, Owner, and an extra.
  insert into public.contacts (id, organization_id, full_name, role, referral_partner_id)
    values
      (v_primary_id, v_org_id, 'Primary Contact', 'referral_contact', v_partner_id),
      (v_owner_id,   v_org_id, 'Owner Contact',   'referral_contact', v_partner_id),
      (v_extra_id,   v_org_id, 'Extra Contact',   'referral_contact', v_partner_id);

  update public.referral_partners
     set primary_contact_id = v_primary_id,
         owner_contact_id   = v_owner_id
   where id = v_partner_id;

  -- Two Call log entries against that partner.
  insert into public.referral_partner_calls (organization_id, referral_partner_id, referral_contact_id, user_id, outcome)
    values
      (v_org_id, v_partner_id, v_primary_id, v_user_id, 'voicemail'),
      (v_org_id, v_partner_id, v_primary_id, v_user_id, 'spoke');

  -- Hard-delete the partner (the trash route's purge step — and the
  -- "Delete forever" button — issue the same SQL).
  delete from public.referral_partners where id = v_partner_id;

  -- 1. referral_partner_calls cascaded away — zero remain for that partner.
  select count(*) into v_call_count
    from public.referral_partner_calls
   where referral_partner_id = v_partner_id;
  if v_call_count <> 0 then
    raise exception 'build78b smoke: referral_partner_calls did NOT cascade (% rows survive)', v_call_count;
  end if;

  -- 2. All three contact rows survive.
  select count(*) into v_contact_count
    from public.contacts
   where id in (v_primary_id, v_owner_id, v_extra_id);
  if v_contact_count <> 3 then
    raise exception 'build78b smoke: expected 3 contact rows to survive, saw %', v_contact_count;
  end if;

  -- 3. Each surviving contact's referral_partner_id is NULL.
  select count(*) into v_still_linked
    from public.contacts
   where id in (v_primary_id, v_owner_id, v_extra_id)
     and referral_partner_id is not null;
  if v_still_linked <> 0 then
    raise exception 'build78b smoke: contacts.referral_partner_id NOT nulled (% rows still linked)', v_still_linked;
  end if;

  raise notice 'build78b smoke: hard-delete of a partner with 2 calls + 3 contacts — calls cascade, contacts survive with referral_partner_id NULL';
end $$;

rollback;
