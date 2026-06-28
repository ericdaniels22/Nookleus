-- issue #789 (follow-up to #615) — track when the current Google refresh token
-- was issued, so the Marketing page can warn before the Testing-mode 7-day
-- expiry silently breaks the connection.
--
-- While the consent screen for project `nookleus` is in "Testing", Google
-- expires the business.manage *sensitive*-scope refresh token 7 days after
-- consent. To count that down accurately we need the issue time of the CURRENT
-- token — and neither existing column gives it:
--
--   * created_at is frozen at FIRST connect (the upsert never rewrites it), so
--     after a reconnect it under-reports the token's age.
--   * updated_at is bumped hourly by the token-refresh chokepoint
--     (trg_google_connection_updated_at -> update_updated_at()), so it tracks
--     "last touched", not "last consented".
--
-- last_consented_at is stamped by the OAuth callback on every connect AND
-- reconnect, giving a countdown that resets each time the admin re-links. Once
-- the app is published to Production the 7-day expiry is gone and the column is
-- harmless — the UI hides the countdown via GOOGLE_OAUTH_TESTING_MODE=false.
--
-- Additive + backfilled, so it is safe to apply to a populated table.
--
-- Depends on: supabase/migration-615-google-connection.sql.
-- Revert:     see -- ROLLBACK --- block at the bottom.

alter table public.google_connection
  add column if not exists last_consented_at timestamptz;

-- Backfill existing rows to created_at — the best estimate of the last consent
-- we have for a row that predates this column. Conservative: if it under-counts
-- (the row was reconnected after first connect), the worst case is a harmless
-- early reconnect prompt, and the next reconnect stamps the true time.
update public.google_connection
   set last_consented_at = created_at
 where last_consented_at is null;

alter table public.google_connection
  alter column last_consented_at set default now();
alter table public.google_connection
  alter column last_consented_at set not null;

-- ROLLBACK ---
-- alter table public.google_connection drop column if exists last_consented_at;
