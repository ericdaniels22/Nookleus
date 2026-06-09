// Integration coverage for `create_estimate_with_template` — the PL/pgSQL RPC
// introduced by #571. One call creates the draft estimate (default-title
// resolution + atomic numbering via generate_estimate_number), optionally
// applies a template (line-item snapshot per ADR 0004, which also recomputes
// totals), and returns the new estimate id.
//
// Harness: same throwaway embedded-postgres pattern as
// apply-template.pg.test.ts — a focused schema plus the LIVE migration SQL
// verbatim (no copy-paste drift), driven through a raw `pg` client.
// generate_estimate_number lives in the (huge) estimates-foundation migration,
// so it is sliced out by its own CREATE/GRANT anchors instead of loading a
// dozen unrelated tables; the slice fails loudly if that section is ever
// reshaped. Run with `npm run test:pg`.
//
// node-postgres returns `numeric` columns as strings to preserve precision, so
// every numeric assertion coerces with Number().

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
  join(process.cwd(), "tests", "integration", "create-estimate-with-template-schema.sql"),
  "utf8",
);

// generate_estimate_number — sliced from the foundation migration by its own
// anchors so the live SQL loads verbatim without the rest of the file.
const NUMBERING_SQL = (() => {
  const foundation = readFileSync(
    join(process.cwd(), "supabase", "migration-build67a-estimates-foundation.sql"),
    "utf8",
  );
  const startAnchor = "CREATE OR REPLACE FUNCTION generate_estimate_number";
  const endAnchor = "GRANT EXECUTE ON FUNCTION generate_estimate_number(uuid) TO authenticated;";
  const start = foundation.indexOf(startAnchor);
  const end = foundation.indexOf(endAnchor);
  if (start === -1 || end === -1) {
    throw new Error(
      "could not slice generate_estimate_number out of migration-build67a-estimates-foundation.sql",
    );
  }
  return foundation.slice(start, end + endAnchor.length);
})();

// #382b carries the CURRENT full body of apply_template_to_estimate — the
// collaborator the create RPC delegates the template-apply + totals leg to.
// (Its convert_estimate_to_invoice body also loads but is never executed.)
const APPLY_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-382b-copy-line-item-note.sql"),
  "utf8",
);

// The migration under test.
const CREATE_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-571-create-estimate-with-template.sql"),
  "utf8",
);

/** Grab a free ephemeral port so the cluster never collides with the local
 *  PostgreSQL 17/18 services already listening on 5432. */
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

const TEST_DB = "create_estimate_test";

beforeAll(async () => {
  // Data dir under the OS temp root, NOT under the OneDrive-synced project
  // tree (OneDrive interferes with initdb's file locking).
  dataDir = mkdtempSync(join(tmpdir(), "nookleus-pg-"));
  pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: await freePort(),
    user: "postgres",
    password: "postgres",
    persistent: false, // stop() wipes the data dir
    // Match prod: a UTF8 cluster. Without this, initdb inherits the Windows
    // WIN1252 locale and chokes on the UTF-8 arrows/box-drawing in the real
    // migration's comments. `--locale=C` keeps UTF8 valid on Windows.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });

  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase(TEST_DB);

  client = pgServer.getPgClient(TEST_DB);
  await client.connect();

  // The shipped migrations end with `GRANT EXECUTE ... TO authenticated`, a
  // role Supabase provides but a bare cluster doesn't. Create it so the real
  // SQL loads verbatim.
  await client.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF; END $$;",
  );
  await client.query(SCHEMA_SQL); // tables first (the functions' %ROWTYPE needs them)
  await client.query(NUMBERING_SQL); // generate_estimate_number (build67a §12)
  await client.query(APPLY_SQL); // #382b: current apply_template_to_estimate
  await client.query(CREATE_SQL); // #571: the RPC under test
}, 120_000);

afterAll(async () => {
  if (client) await client.end().catch(() => {});
  if (pgServer) await pgServer.stop().catch(() => {});
  // On Windows the cluster can still hold file handles when cleanup runs; a
  // failed rmSync must never fail an otherwise-green suite.
  if (dataDir) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best-effort temp-dir cleanup */
    }
  }
});

/** Insert a job under `orgId`; returns its id. */
async function seedJob(orgId: string, jobNumber: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO jobs (organization_id, job_number) VALUES ($1, $2) RETURNING id",
    [orgId, jobNumber],
  );
  return rows[0].id;
}

/** Call the RPC under test; returns the new estimate id. */
async function createEstimate(
  jobId: string,
  title: string | null,
  templateId: string | null,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT create_estimate_with_template($1::uuid, $2::text, $3::uuid) AS id",
    [jobId, title, templateId],
  );
  return rows[0].id;
}

interface EstimateRow {
  organization_id: string;
  job_id: string;
  estimate_number: string;
  sequence_number: number;
  title: string;
  status: string;
  created_by: string | null;
  subtotal: string; // numeric -> string from pg
  markup_amount: string;
  discount_amount: string;
  adjusted_subtotal: string;
  tax_amount: string;
  total: string;
}

async function fetchEstimate(estimateId: string): Promise<EstimateRow> {
  const { rows } = await client.query<EstimateRow>("SELECT * FROM estimates WHERE id = $1", [
    estimateId,
  ]);
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe("create_estimate_with_template (#571)", () => {
  // ── Tracer: the no-template call composes the whole create path — job
  //    lookup, title fallback, atomic numbering, draft insert — and returns
  //    the new id. No template means no sections and zero totals. ───────────
  it("creates an empty draft with the fallback title, a generated number, and zero totals", async () => {
    const orgId = randomUUID();
    const jobId = await seedJob(orgId, "2026-014");

    const estimateId = await createEstimate(jobId, null, null);

    const e = await fetchEstimate(estimateId);
    expect(e.organization_id).toBe(orgId);
    expect(e.job_id).toBe(jobId);
    expect(e.estimate_number).toBe("2026-014-EST-1");
    expect(e.sequence_number).toBe(1);
    expect(e.title).toBe("Estimate"); // no org default seeded → hard fallback
    expect(e.status).toBe("draft");
    expect(Number(e.subtotal)).toBe(0);
    expect(Number(e.total)).toBe(0);

    const { rows: sections } = await client.query(
      "SELECT id FROM estimate_sections WHERE estimate_id = $1",
      [estimateId],
    );
    expect(sections).toHaveLength(0);
  });

  // ── Title resolution rung 2: with no explicit title, the org's standard
  //    title (company_settings key `default_estimate_title`) wins over the
  //    hard fallback. Scoped per org — another org's setting must not leak. ──
  it("uses the org's default_estimate_title setting when no title is passed", async () => {
    const orgId = randomUUID();
    const otherOrgId = randomUUID();
    const jobId = await seedJob(orgId, "2026-015");
    await client.query(
      "INSERT INTO company_settings (organization_id, key, value) VALUES ($1, 'default_estimate_title', 'Scope of Work')",
      [orgId],
    );
    await client.query(
      "INSERT INTO company_settings (organization_id, key, value) VALUES ($1, 'default_estimate_title', 'WRONG ORG TITLE')",
      [otherOrgId],
    );

    const estimateId = await createEstimate(jobId, null, null);

    const e = await fetchEstimate(estimateId);
    expect(e.title).toBe("Scope of Work");
  });

  // ── Title resolution rung 1: an explicit title from the modal beats the
  //    org setting; a blank one falls through to it. ────────────────────────
  it("prefers an explicit title over the org setting, treating blank as unset", async () => {
    const orgId = randomUUID();
    const jobId = await seedJob(orgId, "2026-016");
    await client.query(
      "INSERT INTO company_settings (organization_id, key, value) VALUES ($1, 'default_estimate_title', 'Scope of Work')",
      [orgId],
    );

    const explicitId = await createEstimate(jobId, "Roof Replacement", null);
    expect((await fetchEstimate(explicitId)).title).toBe("Roof Replacement");

    const blankId = await createEstimate(jobId, "   ", null);
    expect((await fetchEstimate(blankId)).title).toBe("Scope of Work");
  });

  // ── Numbering composes per job: successive creates on one job take the
  //    next sequence; a sibling job starts back at 1. ───────────────────────
  it("numbers successive estimates per job via generate_estimate_number", async () => {
    const orgId = randomUUID();
    const jobA = await seedJob(orgId, "2026-017");
    const jobB = await seedJob(orgId, "2026-018");

    const first = await fetchEstimate(await createEstimate(jobA, null, null));
    const second = await fetchEstimate(await createEstimate(jobA, null, null));
    const sibling = await fetchEstimate(await createEstimate(jobB, null, null));

    expect(first.estimate_number).toBe("2026-017-EST-1");
    expect(second.estimate_number).toBe("2026-017-EST-2");
    expect(second.sequence_number).toBe(2);
    expect(sibling.estimate_number).toBe("2026-018-EST-1");
  });

  // ── The template leg: one call creates the draft AND applies the snapshot
  //    (delegating to apply_template_to_estimate, which recomputes totals and
  //    copies the template's statements). ───────────────────────────────────
  it("applies the chosen template: line items land on the new estimate and totals are recomputed", async () => {
    const orgId = randomUUID();
    const jobId = await seedJob(orgId, "2026-019");

    const structure = {
      sections: [
        {
          title: "Mitigation",
          sort_order: 0,
          subsections: [],
          items: [
            {
              library_item_id: null,
              name: "Dehumidifier",
              description: "LGR dehumidifier, daily rate",
              code: "WTR-04",
              unit: "day",
              quantity: 2,
              unit_price: 100,
              sort_order: 0,
            },
          ],
        },
      ],
    };
    const { rows: tmplRows } = await client.query<{ id: string }>(
      `INSERT INTO estimate_templates (organization_id, name, structure, opening_statement)
       VALUES ($1, 'Water Mitigation', $2, 'Thank you for choosing AAA.')
       RETURNING id`,
      [orgId, JSON.stringify(structure)],
    );

    const estimateId = await createEstimate(jobId, null, tmplRows[0].id);

    const { rows: items } = await client.query<{ name: string | null; total: string }>(
      "SELECT name, total FROM estimate_line_items WHERE estimate_id = $1",
      [estimateId],
    );
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Dehumidifier");
    expect(Number(items[0].total)).toBe(200); // 2 × 100

    const { rows: estimates } = await client.query<
      EstimateRow & { opening_statement: string | null }
    >("SELECT * FROM estimates WHERE id = $1", [estimateId]);
    const e = estimates[0];
    // A fresh draft has no markup/discount/tax, so the waterfall collapses to
    // the snapshot subtotal — proving the recompute ran (defaults were 0).
    expect(Number(e.subtotal)).toBe(200);
    expect(Number(e.adjusted_subtotal)).toBe(200);
    expect(Number(e.total)).toBe(200);
    expect(e.opening_statement).toBe("Thank you for choosing AAA.");
  });

  // ── The draft is stamped with the caller (auth.uid(), stubbed in the test
  //    schema via the `test.auth_uid` session setting). ─────────────────────
  it("stamps created_by with the calling user", async () => {
    const orgId = randomUUID();
    const userId = randomUUID();
    const jobId = await seedJob(orgId, "2026-020");

    await client.query("SELECT set_config('test.auth_uid', $1, false)", [userId]);
    try {
      const estimateId = await createEstimate(jobId, null, null);
      expect((await fetchEstimate(estimateId)).created_by).toBe(userId);
    } finally {
      await client.query("SELECT set_config('test.auth_uid', '', false)");
    }
  });

  // ── Guards: each precondition raises a distinct error token, surfaced by
  //    the `pg` client as a rejected query. ─────────────────────────────────
  describe("guards", () => {
    it("rejects when the job does not exist (job_not_found)", async () => {
      await expect(createEstimate(randomUUID(), null, null)).rejects.toThrow(/job_not_found/);
    });

    // The whole point of the single RPC: when the template leg fails, the
    // draft insert from the same call rolls back — no orphaned estimate.
    it("rolls back the draft when the template apply fails", async () => {
      const orgId = randomUUID();
      const jobId = await seedJob(orgId, "2026-021");
      const { rows: tmpl } = await client.query<{ id: string }>(
        "INSERT INTO estimate_templates (organization_id, name, is_active) VALUES ($1, 'Retired', false) RETURNING id",
        [orgId],
      );

      await expect(createEstimate(jobId, null, tmpl[0].id)).rejects.toThrow(
        /template_not_found_or_inactive/,
      );

      const { rows: estimates } = await client.query(
        "SELECT id FROM estimates WHERE job_id = $1",
        [jobId],
      );
      expect(estimates).toHaveLength(0);
    });
  });
});
