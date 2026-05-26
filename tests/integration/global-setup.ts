// Vitest `globalSetup` for the jobs→contacts embed harness (#283).
//
// Responsibilities, in order:
//   1. Boot the local Supabase stack (`supabase start`).
//   2. Read its URL + service-role key out of `supabase status -o env`.
//   3. Apply `tests/integration/schema.sql` via `psql` — this is the
//      minimal FK-ambiguity skeleton, not a prod clone (see schema.sql
//      header for the rationale).
//   4. Expose `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL`
//      to the test process via `process.env`.
//   5. On teardown, stop the stack.
//
// Why globalSetup and not beforeAll? Booting the stack takes seconds, and
// we want it once for the whole run, not per-file. Fixture seeding still
// happens in `beforeAll` inside the test file so a single fresh fixture
// is visible across the six tests.
//
// Stack management. We assume `supabase` CLI + Docker are available.
// If a stack is already running on this machine we reuse it (the CLI's
// `start` is a no-op when the project is already up). We always `stop`
// in teardown — devs who want to keep the stack between runs should run
// `supabase start` manually before invoking the harness.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const INTEGRATION_DIR = join(process.cwd(), "tests", "integration");

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
}

function parseSupabaseEnv(envOutput: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of envOutput.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

export async function setup(): Promise<void> {
  console.log("[integration] starting supabase stack...");
  // `start` is idempotent: when the project is already up it prints status
  // and exits 0. When it's down it boots and exits 0 after readiness.
  run("supabase", ["start"]);

  console.log("[integration] reading supabase status...");
  const statusOutput = run("supabase", ["status", "-o", "env"]);
  const status = parseSupabaseEnv(statusOutput);

  const apiUrl = status.API_URL;
  const dbUrl = status.DB_URL;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  if (!apiUrl || !dbUrl || !serviceRoleKey) {
    throw new Error(
      `[integration] could not parse supabase status output; got keys: ${Object.keys(status).join(", ")}`,
    );
  }

  console.log("[integration] applying test schema via psql...");
  run("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", join(INTEGRATION_DIR, "schema.sql")]);

  process.env.SUPABASE_URL = apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;
  process.env.SUPABASE_DB_URL = dbUrl;

  // Smaller bit of resilience: PostgREST caches the schema. Even with the
  // NOTIFY pgrst at the end of schema.sql, on a freshly booted container
  // the listener may not be attached yet. Give it a moment and ping again.
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    run("psql", [dbUrl, "-c", "NOTIFY pgrst, 'reload schema';"]);
  } catch {
    // Non-fatal; the first request will eventually trigger the reload.
  }

  console.log("[integration] ready.");
}

export async function teardown(): Promise<void> {
  console.log("[integration] stopping supabase stack...");
  try {
    run("supabase", ["stop"]);
  } catch (err) {
    console.warn("[integration] supabase stop failed (continuing):", err);
  }
}
