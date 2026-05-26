# Integration test harness

`npm run test:integration` boots a local Supabase stack via `supabase start`,
applies a minimal FK-ambiguity schema (`tests/integration/schema.sql`), seeds
a single job linked to both a homeowner and an insurance contact, and runs
the regression suite at `tests/integration/jobs-contacts-embed.test.ts` —
one test per surface from #282. The harness exists so the PostgREST
embed-disambiguation bug class (`PGRST201`) can't silently come back the
next time a new FK lands.

## Prerequisites

- Supabase CLI installed (`brew install supabase/tap/supabase`,
  `scoop install supabase`, or follow
  [the CLI install guide](https://supabase.com/docs/guides/cli/getting-started)).
- Docker Desktop running — the CLI's `start` command provisions Postgres
  and PostgREST in containers.
- `psql` on `PATH` (used to apply the schema file).

## Running

```sh
npm run test:integration
```

The first run downloads container images (one-time cost). Subsequent runs
boot in a few seconds. The harness stops the stack on teardown; pass
`supabase stop` is idempotent, so a stuck previous run won't break the
next attempt.

## Why a minimal schema?

The schema file under `tests/integration/schema.sql` is intentionally
small — it ships only the tables and FKs the six embed queries touch,
not a full clone of production. The bug class lives entirely in
PostgREST's embed parsing against the FK shape, so reproducing prod
faithfully would be churn without payoff. See the header comment in
that file for the full rationale.

## CI

This repo currently has no GitHub Actions workflow; CI integration for
`test:integration` is tracked as a follow-up. Run it locally before
opening PRs that touch the embed queries.
