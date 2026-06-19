// Integration coverage for the device_tokens table — migration-660-device-
// tokens.sql (#671, feature #667, ADR 0016).
//
// Harness. The repo's blessed integration harness boots Supabase via
// `supabase start` (Docker + virtualization), unavailable here. The thing under
// test is plain DDL + RLS, so we boot a throwaway embedded-postgres cluster,
// load a focused schema + the LIVE migration SQL verbatim (no copy-paste
// drift), and drive it through a raw `pg` client. Nothing touches the network,
// Docker, or the local PG service. Run with `npm run test:pg`.
//
// Both structural facts (UNIQUE(token), upsert-refresh, FK cascade, the
// platform check, defaults, a clean rollback) AND the RLS isolation contract
// are pinned here: the schema shims read GUCs so `SET ROLE authenticated` drives
// the policies. The same RLS contract is pinned again against real prod by
// supabase/migration-660-smoke-test.sql (run via the Supabase MCP).

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCHEMA_SQL = readFileSync(
  join(process.cwd(), "tests", "integration", "device-tokens-schema.sql"),
  "utf8",
);
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-660-device-tokens.sql"),
  "utf8",
);

/** A free ephemeral port so the cluster never collides with a local 5432. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

let pgServer: EmbeddedPostgres;
let dataDir: string;
let client: Client;

const TEST_DB = "device_tokens_test";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "nookleus-pg-"));
  pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: await freePort(),
    user: "postgres",
    password: "postgres",
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });

  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase(TEST_DB);

  client = pgServer.getPgClient(TEST_DB);
  await client.connect();

  // migration-660's policies are `to authenticated`; create the role Supabase
  // provides but a bare cluster does not, so the SQL loads verbatim.
  await client.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF; END $$;",
  );
  await client.query(SCHEMA_SQL);
  await client.query(MIGRATION_SQL);
  // device_tokens now exists — grant the RLS test caller the privileges it
  // needs to evaluate (and be filtered by) the policies.
  await client.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO authenticated;",
  );
}, 120_000);

afterAll(async () => {
  if (client) await client.end().catch(() => {});
  if (pgServer) await pgServer.stop().catch(() => {});
  if (dataDir) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best-effort temp-dir cleanup; Windows may still hold a handle */
    }
  }
});

/** The migration's own commented `-- ROLLBACK ---` block, un-commented and
 *  ready to execute — pins that the documented revert is valid and complete. */
function rollbackSql(): string {
  const marker = "-- ROLLBACK ---";
  const block = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf(marker) + marker.length);
  return block
    .split("\n")
    .map((l) => l.replace(/^--\s?/, "").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

async function seedUser(): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id",
  );
  return rows[0].id;
}

async function seedOrg(): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Org', 'org-' || $1) RETURNING id",
    [randomUUID()],
  );
  return rows[0].id;
}

async function insertToken(
  userId: string,
  orgId: string,
  token: string,
): Promise<void> {
  await client.query(
    "INSERT INTO device_tokens (user_id, organization_id, token) VALUES ($1, $2, $3)",
    [userId, orgId, token],
  );
}

describe("device_tokens migration (#671)", () => {
  // Tracer: uniqueness on the token is the whole design — a duplicate token
  // must be rejected, and an upsert on conflict(token) must refresh, not dup.
  it("enforces UNIQUE(token) and upsert-on-conflict refreshes the row", async () => {
    const userId = await seedUser();
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    await insertToken(userId, orgA, "tok-shared");

    // A second plain insert of the same token is rejected.
    await expect(insertToken(userId, orgB, "tok-shared")).rejects.toThrow();

    // Upsert on conflict(token) refreshes the existing row's org in place.
    await client.query(
      `INSERT INTO device_tokens (user_id, organization_id, token)
         VALUES ($1, $2, 'tok-shared')
       ON CONFLICT (token) DO UPDATE SET organization_id = excluded.organization_id`,
      [userId, orgB],
    );
    const { rows } = await client.query<{ n: number; org: string }>(
      "SELECT count(*)::int AS n, max(organization_id::text) AS org FROM device_tokens WHERE token = 'tok-shared'",
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].org).toBe(orgB);
  });

  it("defaults platform to 'ios' and rejects any other platform", async () => {
    const userId = await seedUser();
    const orgId = await seedOrg();
    const { rows } = await client.query<{ platform: string }>(
      "INSERT INTO device_tokens (user_id, organization_id, token) VALUES ($1, $2, 'plat-default') RETURNING platform",
      [userId, orgId],
    );
    expect(rows[0].platform).toBe("ios");

    await expect(
      client.query(
        "INSERT INTO device_tokens (user_id, organization_id, token, platform) VALUES ($1, $2, 'plat-bad', 'android')",
        [userId, orgId],
      ),
    ).rejects.toThrow();
  });

  it("cascade-deletes a member's tokens when the user is deleted", async () => {
    const userId = await seedUser();
    const orgId = await seedOrg();
    await insertToken(userId, orgId, "cascade-user");

    await client.query("DELETE FROM auth.users WHERE id = $1", [userId]);

    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM device_tokens WHERE token = 'cascade-user'",
    );
    expect(rows[0].n).toBe(0);
  });

  it("cascade-deletes a member's tokens when the organization is deleted", async () => {
    const userId = await seedUser();
    const orgId = await seedOrg();
    await insertToken(userId, orgId, "cascade-org");

    await client.query("DELETE FROM organizations WHERE id = $1", [orgId]);

    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM device_tokens WHERE token = 'cascade-org'",
    );
    expect(rows[0].n).toBe(0);
  });

  it("bumps updated_at on refresh via the trigger", async () => {
    const userId = await seedUser();
    const orgId = await seedOrg();
    await insertToken(userId, orgId, "bump");
    // Force a measurable gap, then touch the row.
    await client.query(
      "UPDATE device_tokens SET updated_at = now() - interval '1 hour' WHERE token = 'bump'",
    );
    const before = await client.query<{ updated_at: string }>(
      "SELECT updated_at FROM device_tokens WHERE token = 'bump'",
    );
    await client.query(
      "UPDATE device_tokens SET platform = 'ios' WHERE token = 'bump'",
    );
    const after = await client.query<{ updated_at: string }>(
      "SELECT updated_at FROM device_tokens WHERE token = 'bump'",
    );
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].updated_at).getTime(),
    );
  });

  // RLS: the slice-defining isolation guarantee — a member reads ONLY their own
  // device addresses. Driven through SET ROLE authenticated with auth.uid()
  // resolving from the test.uid GUC (see device-tokens-schema.sql).
  it("RLS: a member sees only their own tokens, never another member's", async () => {
    const me = await seedUser();
    const other = await seedUser();
    const orgId = await seedOrg();
    await insertToken(me, orgId, "rls-mine");
    await insertToken(other, orgId, "rls-theirs");

    try {
      await client.query("SELECT set_config('test.uid', $1, false)", [me]);
      await client.query("SET ROLE authenticated");
      const { rows } = await client.query<{ token: string }>(
        "SELECT token FROM device_tokens ORDER BY token",
      );
      expect(rows.map((r) => r.token)).toEqual(["rls-mine"]);
    } finally {
      await client.query("RESET ROLE");
      await client.query("SELECT set_config('test.uid', '', false)");
    }
  });

  // RLS: the INSERT WITH CHECK forbids stamping a row with someone else's
  // user_id — a member can only register their OWN device address.
  it("RLS: a member cannot insert a token under another member's user_id", async () => {
    const me = await seedUser();
    const other = await seedUser();
    const orgId = await seedOrg();

    try {
      await client.query("SELECT set_config('test.uid', $1, false)", [me]);
      await client.query("SET ROLE authenticated");
      await expect(
        client.query(
          "INSERT INTO device_tokens (user_id, organization_id, token) VALUES ($1, $2, 'rls-forge')",
          [other, orgId],
        ),
      ).rejects.toThrow();
    } finally {
      await client.query("RESET ROLE");
      await client.query("SELECT set_config('test.uid', '', false)");
    }
  });

  // AC: the migration applies and rolls back cleanly. Run its OWN commented
  // revert block — it must drop the table, index, trigger, and policies without
  // error. Re-apply afterwards (this runs last) so the schema is restored.
  it("rolls back cleanly via its own -- ROLLBACK -- block", async () => {
    await client.query(rollbackSql());

    const { rows: tbl } = await client.query<{ t: string | null }>(
      "SELECT to_regclass('public.device_tokens') AS t",
    );
    expect(tbl[0].t).toBeNull();

    // Restore so the schema is intact if more tests join this file later.
    await client.query(MIGRATION_SQL);
    await client.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO authenticated;",
    );
  });
});
