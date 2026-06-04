// Integration coverage for the #383 official-invoice rule at the SQL layer:
// is_official_invoice_status(text) — the single rule deciding whether an invoice
// status counts as a real bill (sent/partial/paid) or not (draft/voided). The
// same migration rewrites the QuickBooks enqueue / status-recompute trigger
// functions to consult this rule instead of hard-coding status lists.
//
// Harness mirrors apply-template.pg.test.ts: a throwaway embedded-postgres
// cluster loading the LIVE migration SQL verbatim (no copy-paste drift), driven
// through a raw `pg` client. The migration also re-defines the QuickBooks
// trigger functions, whose %ROWTYPE declarations (qb_connection, contacts, jobs,
// invoices) reference tables this focused cluster doesn't have — so we load with
// `check_function_bodies = off`, which stores those bodies verbatim without
// resolving their table refs (the triggers are never fired here). The function
// under test needs no tables. Run with `npm run test:pg`.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-build79-official-invoice-rule.sql"),
  "utf8",
);

/** Grab a free ephemeral port so the cluster never collides with a local PG. */
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

const TEST_DB = "official_invoice_test";

beforeAll(async () => {
  // Data dir under the OS temp root, NOT the OneDrive-synced tree (OneDrive
  // interferes with initdb's file locking).
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

  // Defer body validation so the QuickBooks trigger functions (whose %ROWTYPE
  // decls reference tables absent from this focused cluster) load verbatim. The
  // function under test references no tables and runs fine.
  await client.query("SET check_function_bodies = off");
  await client.query(MIGRATION_SQL);
}, 120_000);

afterAll(async () => {
  if (client) await client.end().catch(() => {});
  if (pgServer) await pgServer.stop().catch(() => {});
  if (dataDir) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best-effort temp-dir cleanup */
    }
  }
});

describe("is_official_invoice_status (#383)", () => {
  // Every status maps to the correct official verdict — the SQL mirror of the
  // TypeScript isOfficialInvoiceStatus isolation test.
  const cases: Array<[string, boolean]> = [
    ["sent", true],
    ["partial", true],
    ["paid", true],
    ["draft", false],
    ["voided", false],
  ];

  it.each(cases)("classifies %s as official=%s", async (status, expected) => {
    const { rows } = await client.query<{ official: boolean }>(
      "SELECT is_official_invoice_status($1) AS official",
      [status],
    );
    expect(rows[0].official).toBe(expected);
  });

  it("treats an unknown status as not official (default-deny)", async () => {
    const { rows } = await client.query<{ official: boolean }>(
      "SELECT is_official_invoice_status($1) AS official",
      ["archived"],
    );
    expect(rows[0].official).toBe(false);
  });
});
