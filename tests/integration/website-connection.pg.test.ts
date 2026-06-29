// Integration coverage for the website_connection table — migration-612-website-
// connection.sql (#612, PRD #603).
//
// Harness. The repo's blessed integration harness boots Supabase via
// `supabase start` (Docker + virtualization), unavailable here. The thing under
// test is plain DDL + RLS, so we boot a throwaway embedded-postgres cluster,
// load a focused schema + the LIVE migration SQL verbatim (no copy-paste
// drift), and drive it through a raw `pg` client. Nothing touches the network,
// Docker, or the local PG service. Run with `npm run test:pg`.
//
// Both structural facts (one-connection-per-org, the status check, FK cascade vs
// SET NULL, the updated_at trigger, a clean rollback) AND the ADMIN-ONLY RLS
// contract are pinned here: the schema shim defines a real user_organizations
// table so `SET ROLE authenticated` drives the role = 'admin' policy. The same
// RLS contract is pinned again against real prod by
// supabase/migration-612-smoke-test.sql (run via the Supabase MCP).

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
  join(process.cwd(), "tests", "integration", "website-connection-schema.sql"),
  "utf8",
);
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-612-website-connection.sql"),
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

const TEST_DB = "website_connection_test";

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

  // migration-612's policy is `to authenticated`; create the role Supabase
  // provides but a bare cluster does not, so the SQL loads verbatim.
  await client.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF; END $$;",
  );
  await client.query(SCHEMA_SQL);
  await client.query(MIGRATION_SQL);
  // website_connection now exists — grant the RLS test caller the privileges it
  // needs to evaluate (and be filtered by) the policy.
  await client.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_connection TO authenticated;",
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

async function insertConnection(
  orgId: string,
  over: { password?: string; connectedBy?: string | null } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO website_connection
       (organization_id, provider, site_url, username, application_password_encrypted, connected_by)
     VALUES ($1, 'wordpress', 'https://example.com', 'marketing', $2, $3)`,
    [orgId, over.password ?? "enc", over.connectedBy ?? null],
  );
}

describe("website_connection migration (#612)", () => {
  // Tracer: one connection per Organization is the whole design — a second row
  // for the same org must be rejected, and an upsert on conflict(organization_id)
  // must overwrite in place, not stack a second.
  it("enforces one connection per org and upsert-on-conflict overwrites in place", async () => {
    const orgA = await seedOrg();
    await insertConnection(orgA, { password: "enc-1" });

    // A second plain insert for the same org is rejected.
    await expect(insertConnection(orgA, { password: "enc-2" })).rejects.toThrow();

    // Upsert on conflict(organization_id) overwrites the existing row in place.
    await client.query(
      `INSERT INTO website_connection
         (organization_id, provider, site_url, username, application_password_encrypted)
       VALUES ($1, 'wordpress', 'https://example.com', 'marketing', 'enc-3')
       ON CONFLICT (organization_id) DO UPDATE SET application_password_encrypted = excluded.application_password_encrypted`,
      [orgA],
    );
    const { rows } = await client.query<{ n: number; pw: string }>(
      "SELECT count(*)::int AS n, max(application_password_encrypted) AS pw FROM website_connection WHERE organization_id = $1",
      [orgA],
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].pw).toBe("enc-3");
  });

  it("status defaults to 'connected', accepts 'broken', rejects anything else", async () => {
    const orgId = await seedOrg();
    const { rows } = await client.query<{ status: string }>(
      `INSERT INTO website_connection
         (organization_id, provider, site_url, username, application_password_encrypted)
       VALUES ($1, 'wordpress', 'https://example.com', 'marketing', 'enc')
       RETURNING status`,
      [orgId],
    );
    expect(rows[0].status).toBe("connected");

    await client.query(
      "UPDATE website_connection SET status = 'broken' WHERE organization_id = $1",
      [orgId],
    );

    await expect(
      client.query(
        "UPDATE website_connection SET status = 'bogus' WHERE organization_id = $1",
        [orgId],
      ),
    ).rejects.toThrow();
  });

  it("cascade-deletes the connection when its Organization is deleted", async () => {
    const orgId = await seedOrg();
    await insertConnection(orgId);

    await client.query("DELETE FROM organizations WHERE id = $1", [orgId]);

    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM website_connection WHERE organization_id = $1",
      [orgId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("nulls connected_by (not delete) when the connecting user is removed", async () => {
    const userId = await seedUser();
    const orgId = await seedOrg();
    await insertConnection(orgId, { connectedBy: userId });

    await client.query("DELETE FROM auth.users WHERE id = $1", [userId]);

    // The row survives — only connected_by is nulled (SET NULL, not CASCADE).
    const { rows } = await client.query<{ n: number; cb: string | null }>(
      "SELECT count(*)::int AS n, max(connected_by::text) AS cb FROM website_connection WHERE organization_id = $1",
      [orgId],
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].cb).toBeNull();
  });

  it("bumps updated_at on update via the trigger", async () => {
    const orgId = await seedOrg();
    await insertConnection(orgId);
    await client.query(
      "UPDATE website_connection SET updated_at = now() - interval '1 hour' WHERE organization_id = $1",
      [orgId],
    );
    const before = await client.query<{ updated_at: string }>(
      "SELECT updated_at FROM website_connection WHERE organization_id = $1",
      [orgId],
    );
    await client.query(
      "UPDATE website_connection SET status = 'broken' WHERE organization_id = $1",
      [orgId],
    );
    const after = await client.query<{ updated_at: string }>(
      "SELECT updated_at FROM website_connection WHERE organization_id = $1",
      [orgId],
    );
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].updated_at).getTime(),
    );
  });

  // RLS: the slice-defining guarantee — Marketing is ADMIN-only. A non-admin
  // member of the active org sees nothing and cannot write; promoting them to
  // admin makes the row visible. Driven through SET ROLE authenticated with
  // auth.uid()/active_organization_id() resolving from GUCs.
  it("RLS: a non-admin member is denied; an admin member sees the connection", async () => {
    const user = await seedUser();
    const orgId = await seedOrg();
    await insertConnection(orgId); // seeded under owner bypass
    await client.query(
      "INSERT INTO user_organizations (user_id, organization_id, role) VALUES ($1, $2, 'crew_member')",
      [user, orgId],
    );

    try {
      await client.query("SELECT set_config('test.uid', $1, false)", [user]);
      await client.query("SELECT set_config('test.org', $1, false)", [orgId]);
      await client.query("SET ROLE authenticated");

      // Non-admin member: sees nothing.
      const asMember = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM website_connection",
      );
      expect(asMember.rows[0].n).toBe(0);
    } finally {
      await client.query("RESET ROLE");
    }

    // Promote to admin (owner bypass) — now the same caller sees the row.
    await client.query(
      "UPDATE user_organizations SET role = 'admin' WHERE user_id = $1 AND organization_id = $2",
      [user, orgId],
    );
    try {
      await client.query("SET ROLE authenticated");
      const asAdmin = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM website_connection",
      );
      expect(asAdmin.rows[0].n).toBe(1);
    } finally {
      await client.query("RESET ROLE");
      await client.query("SELECT set_config('test.uid', '', false)");
      await client.query("SELECT set_config('test.org', '', false)");
    }
  });

  // RLS: an admin of org B cannot write a row scoped to org A — the WITH CHECK
  // requires the row's org to equal the caller's active org.
  it("RLS: an admin cannot insert a connection for a different Organization", async () => {
    const user = await seedUser();
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    // Admin of org B only.
    await client.query(
      "INSERT INTO user_organizations (user_id, organization_id, role) VALUES ($1, $2, 'admin')",
      [user, orgB],
    );

    try {
      await client.query("SELECT set_config('test.uid', $1, false)", [user]);
      await client.query("SELECT set_config('test.org', $1, false)", [orgB]);
      await client.query("SET ROLE authenticated");
      await expect(
        client.query(
          `INSERT INTO website_connection
             (organization_id, provider, site_url, username, application_password_encrypted)
           VALUES ($1, 'wordpress', 'https://example.com', 'marketing', 'enc')`,
          [orgA],
        ),
      ).rejects.toThrow();
    } finally {
      await client.query("RESET ROLE");
      await client.query("SELECT set_config('test.uid', '', false)");
      await client.query("SELECT set_config('test.org', '', false)");
    }
  });

  // RLS: a non-admin member of their OWN active org cannot WRITE. This isolates
  // the role='admin' WITH CHECK from the org-scoping clause and from the unique
  // constraint: the org has NO existing row, so a weakened check (e.g. dropping
  // the role test, or WITH CHECK (true)) would let this insert THROUGH — there
  // is no unique collision to mask the regression. The real policy denies it.
  it("RLS: a non-admin member cannot insert a connection for their own active org", async () => {
    const user = await seedUser();
    const orgId = await seedOrg();
    // A plain member, NOT an admin, of their active org. No row exists yet.
    await client.query(
      "INSERT INTO user_organizations (user_id, organization_id, role) VALUES ($1, $2, 'crew_member')",
      [user, orgId],
    );

    try {
      await client.query("SELECT set_config('test.uid', $1, false)", [user]);
      await client.query("SELECT set_config('test.org', $1, false)", [orgId]);
      await client.query("SET ROLE authenticated");
      await expect(
        client.query(
          `INSERT INTO website_connection
             (organization_id, provider, site_url, username, application_password_encrypted)
           VALUES ($1, 'wordpress', 'https://example.com', 'marketing', 'enc')`,
          [orgId],
        ),
      ).rejects.toThrow();
    } finally {
      await client.query("RESET ROLE");
      await client.query("SELECT set_config('test.uid', '', false)");
      await client.query("SELECT set_config('test.org', '', false)");
    }

    // And nothing was written (asserted under the owner/superuser bypass).
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM website_connection WHERE organization_id = $1",
      [orgId],
    );
    expect(rows[0].n).toBe(0);
  });

  // AC: the migration applies and rolls back cleanly. Run its OWN commented
  // revert block — it must drop the table, index, trigger, and policy without
  // error. Re-apply afterwards (this runs last) so the schema is restored.
  it("rolls back cleanly via its own -- ROLLBACK -- block", async () => {
    await client.query(rollbackSql());

    const { rows: tbl } = await client.query<{ t: string | null }>(
      "SELECT to_regclass('public.website_connection') AS t",
    );
    expect(tbl[0].t).toBeNull();

    // Restore so the schema is intact if more tests join this file later.
    await client.query(MIGRATION_SQL);
    await client.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_connection TO authenticated;",
    );
  });
});
