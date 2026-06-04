// Integration coverage for `convert_estimate_to_invoice` — specifically that a
// line item's `note` (#382) carries from the estimate onto the new invoice line
// item during conversion.
//
// Harness mirrors apply-template.pg.test.ts: the blessed integration harness
// (tests/integration/global-setup.ts) needs Docker + hardware virtualization,
// unavailable here, so we boot a throwaway embedded-postgres cluster, load a
// focused schema + the LIVE migration SQL verbatim, and drive it through a raw
// `pg` client at the SQL layer. Run with `npm run test:pg`.
//
// The setup loads the current production convert function (migration-build67f)
// THEN migration-382b (the note-aware body swap), so 382b's convert overrides.
//
// node-postgres returns `numeric` columns as strings; numeric assertions coerce
// with Number().

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
  join(process.cwd(), "tests", "integration", "convert-estimate-schema.sql"),
  "utf8",
);
// The current production convert function (allow-convert-from-any-status).
const CONVERT_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-build67f-convert-any-status.sql"),
  "utf8",
);
// #382: the note-aware body swap. Loaded last so convert copies the note.
const NOTE_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-382b-copy-line-item-note.sql"),
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

const TEST_DB = "convert_estimate_test";

beforeAll(async () => {
  // Data dir under the OS temp root, NOT under the OneDrive-synced project tree.
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

  // The shipped migrations end with `GRANT EXECUTE ... TO authenticated`.
  await client.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF; END $$;",
  );
  await client.query(SCHEMA_SQL); // tables + auth.uid()/generate_invoice_number stubs
  await client.query(CONVERT_SQL); // build67f: production convert (no note copy)
  await client.query(NOTE_SQL); // #382: note-aware convert overrides build67f
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

interface InvoiceLineItemRow {
  name: string | null;
  description: string;
  note: string | null;
  code: string | null;
  unit: string | null;
  quantity: string;
  unit_price: string;
  amount: string;
}

/** Seed an estimate with one section holding a single line item; returns ids. */
async function seedEstimateWithItem(
  orgId: string,
  note: string | null,
): Promise<{ estimateId: string }> {
  const { rows: estRows } = await client.query<{ id: string }>(
    "INSERT INTO estimates (organization_id, job_id, status, title) VALUES ($1, $2, 'draft', 'Roof repair') RETURNING id",
    [orgId, randomUUID()],
  );
  const estimateId = estRows[0].id;

  const { rows: secRows } = await client.query<{ id: string }>(
    "INSERT INTO estimate_sections (organization_id, estimate_id, title, sort_order) VALUES ($1, $2, 'Roofing', 0) RETURNING id",
    [orgId, estimateId],
  );
  const sectionId = secRows[0].id;

  await client.query(
    `INSERT INTO estimate_line_items
       (organization_id, estimate_id, section_id, name, description, note, code, quantity, unit, unit_price, total, sort_order)
     VALUES ($1, $2, $3, 'Shingles', 'Replace damaged shingles', $4, 'RF-01', 1, 'sq', 100, 100, 0)`,
    [orgId, estimateId, sectionId, note],
  );

  return { estimateId };
}

describe("convert_estimate_to_invoice — line-item note (#382)", () => {
  it("copies a line item's note onto the new invoice line item", async () => {
    const orgId = randomUUID();
    const { estimateId } = await seedEstimateWithItem(orgId, "Match existing shingle color");

    const { rows: result } = await client.query<{ new_invoice_id: string }>(
      "SELECT convert_estimate_to_invoice($1) AS new_invoice_id",
      [estimateId],
    );
    const newInvoiceId = result[0].new_invoice_id;

    const { rows: items } = await client.query<InvoiceLineItemRow>(
      "SELECT * FROM invoice_line_items WHERE invoice_id = $1",
      [newInvoiceId],
    );
    expect(items).toHaveLength(1);
    expect(items[0].note).toBe("Match existing shingle color");
    // Sanity: the rest of the snapshot still rides along.
    expect(items[0].description).toBe("Replace damaged shingles");
    expect(items[0].name).toBe("Shingles");
  });

  it("carries a null note through conversion as null", async () => {
    const orgId = randomUUID();
    const { estimateId } = await seedEstimateWithItem(orgId, null);

    const { rows: result } = await client.query<{ new_invoice_id: string }>(
      "SELECT convert_estimate_to_invoice($1) AS new_invoice_id",
      [estimateId],
    );

    const { rows: items } = await client.query<InvoiceLineItemRow>(
      "SELECT * FROM invoice_line_items WHERE invoice_id = $1",
      [result[0].new_invoice_id],
    );
    expect(items).toHaveLength(1);
    expect(items[0].note).toBeNull();
  });
});
