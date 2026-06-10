// Integration coverage for the phone_recordings table + organizations
// recording-default column — migration-315-phone-recordings.sql (#315,
// PRD #304 story 38/40, ADR 0005/0006).
//
// Harness. The repo's blessed integration harness (tests/integration/
// global-setup.ts) boots Supabase via `supabase start`, which needs Docker +
// hardware virtualization — unavailable on this machine. The thing under test
// here is plain DDL (a table, its FK CASCADE, a UNIQUE, two column defaults),
// so we boot a throwaway embedded-postgres cluster, load a focused schema +
// the LIVE migration SQL verbatim (no copy-paste drift), and drive it through
// a raw `pg` client. Nothing touches the network, Docker, or the local PG
// service. Run with `npm run test:pg`.
//
// RLS is NOT exercised here (the harness connects as the superuser, which
// bypasses row security) — the ADR-0005 visibility matrix is pinned by
// supabase/migration-315-smoke-test.sql, run via the Supabase MCP.

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
  join(process.cwd(), "tests", "integration", "phone-recordings-schema.sql"),
  "utf8",
);
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-315-phone-recordings.sql"),
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

const TEST_DB = "phone_recordings_test";

beforeAll(async () => {
  // Data dir under the OS temp root, NOT the OneDrive-synced project tree
  // (OneDrive interferes with initdb's file locking).
  dataDir = mkdtempSync(join(tmpdir(), "nookleus-pg-"));
  pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: await freePort(),
    user: "postgres",
    password: "postgres",
    persistent: false,
    // Match prod: a UTF8 cluster. Without this, initdb inherits the Windows
    // WIN1252 locale and chokes on the UTF-8 box-drawing in the real migration
    // comments. `--locale=C` keeps UTF8 valid on Windows.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });

  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase(TEST_DB);

  client = pgServer.getPgClient(TEST_DB);
  await client.connect();

  // migration-315's policy is `for select to authenticated`; create the role
  // Supabase provides but a bare cluster doesn't, so the SQL loads verbatim.
  await client.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF; END $$;",
  );
  await client.query(SCHEMA_SQL);
  await client.query(MIGRATION_SQL);
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
 *  ready to execute — so the test pins that the documented revert is valid and
 *  complete (no drift between the comment and reality). */
function rollbackSql(): string {
  const marker = "-- ROLLBACK ---";
  const block = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf(marker) + marker.length);
  return block
    .split("\n")
    .map((l) => l.replace(/^--\s?/, "").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

async function seedOrg(): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Org', 'org-' || $1) RETURNING id",
    [randomUUID()],
  );
  return rows[0].id;
}

async function seedCall(orgId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO phone_calls (organization_id) VALUES ($1) RETURNING id",
    [orgId],
  );
  return rows[0].id;
}

describe("phone_recordings migration (#315)", () => {
  // Tracer: the two slice-defining defaults. recording_enabled_default true so
  // existing + new orgs record by default (spec); consent_notice_played true so
  // a webhook-written row documents that the notice fired.
  it("defaults recording_enabled_default and consent_notice_played to true", async () => {
    const { rows: orgRows } = await client.query<{
      recording_enabled_default: boolean;
    }>(
      "INSERT INTO organizations (name, slug) VALUES ('Org', 'org-' || $1) RETURNING recording_enabled_default",
      [randomUUID()],
    );
    expect(orgRows[0].recording_enabled_default).toBe(true);

    const orgId = await seedOrg();
    const callId = await seedCall(orgId);
    const { rows } = await client.query<{ consent_notice_played: boolean }>(
      "INSERT INTO phone_recordings (organization_id, phone_call_id) VALUES ($1, $2) RETURNING consent_notice_played",
      [orgId, callId],
    );
    expect(rows[0].consent_notice_played).toBe(true);
  });

  it("cascade-deletes the recording when its parent call is deleted", async () => {
    const orgId = await seedOrg();
    const callId = await seedCall(orgId);
    await client.query(
      "INSERT INTO phone_recordings (organization_id, phone_call_id) VALUES ($1, $2)",
      [orgId, callId],
    );
    await client.query("DELETE FROM phone_calls WHERE id = $1", [callId]);
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM phone_recordings WHERE phone_call_id = $1",
      [callId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("enforces one recording per call (UNIQUE phone_call_id)", async () => {
    const orgId = await seedOrg();
    const callId = await seedCall(orgId);
    await client.query(
      "INSERT INTO phone_recordings (organization_id, phone_call_id) VALUES ($1, $2)",
      [orgId, callId],
    );
    await expect(
      client.query(
        "INSERT INTO phone_recordings (organization_id, phone_call_id) VALUES ($1, $2)",
        [orgId, callId],
      ),
    ).rejects.toThrow();
  });

  // AC: "phone_recordings migration applies and rolls back cleanly." Run the
  // migration's OWN commented revert block — it must drop the table, the index,
  // the policy, and the organizations column without error. Re-apply afterwards
  // so the cluster is restored for any tests added later (this runs last).
  it("rolls back cleanly via its own -- ROLLBACK -- block", async () => {
    await client.query(rollbackSql());

    const { rows: tbl } = await client.query<{ t: string | null }>(
      "SELECT to_regclass('public.phone_recordings') AS t",
    );
    expect(tbl[0].t).toBeNull();

    const { rows: col } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'recording_enabled_default'",
    );
    expect(col[0].n).toBe(0);

    // Restore so the schema is intact if more tests join this file later.
    await client.query(MIGRATION_SQL);
  });
});
