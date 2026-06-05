import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Drift guard for the core schema snapshot (issue #429).
 *
 * Every core-domain table in production carries an `organization_id`
 * (uuid NOT NULL, FK -> organizations) for multi-tenant isolation, added
 * platform-wide by the Build 42–58 migrations. The snapshot in
 * `supabase/schema.sql` was a single-tenant "v1.0" file that omitted it on
 * every table. This test fails if any core table's CREATE TABLE block stops
 * declaring `organization_id`, catching a future re-drift before it ships.
 *
 * Vitest runs with the repo root as cwd, so the snapshot resolves relative to
 * `process.cwd()`.
 */
const SCHEMA_PATH = path.join(process.cwd(), "supabase", "schema.sql");

const CORE_TABLES = [
  "contacts",
  "jobs",
  "job_activities",
  "invoices",
  "payments",
  "invoice_line_items",
] as const;

/**
 * Return the body of `CREATE TABLE <table> ( ... );` from the snapshot. The
 * statement terminator is a line-leading `);`; mid-column parens
 * (`gen_random_uuid()`, `CHECK (... )`) never sit at the start of a line, so a
 * non-greedy match stops at the real table terminator.
 */
function createTableBlock(sql: string, table: string): string {
  const match = sql.match(
    new RegExp(`CREATE TABLE ${table}\\s*\\(([\\s\\S]*?)\\n\\);`)
  );
  if (!match) {
    throw new Error(`No CREATE TABLE block found for "${table}" in schema.sql`);
  }
  return match[1];
}

describe("schema.sql multi-tenant drift guard", () => {
  const sql = readFileSync(SCHEMA_PATH, "utf8");

  it.each(CORE_TABLES)("declares organization_id on the %s table", (table) => {
    const block = createTableBlock(sql, table);
    expect(block).toMatch(/\borganization_id\b/);
  });

  it("keeps no single-tenant \"Allow all\" policy", () => {
    expect(sql).not.toMatch(/Allow all/);
  });

  it.each(CORE_TABLES)(
    "guards the %s table with a tenant_isolation policy",
    (table) => {
      expect(sql).toMatch(
        new RegExp(`CREATE POLICY tenant_isolation_${table}\\b`)
      );
    }
  );
});

describe("schema.sql line-item table split (#429)", () => {
  const sql = readFileSync(SCHEMA_PATH, "utf8");

  it("replaces the single-tenant line_items table with invoice_line_items", () => {
    // The old invoice-scoped `line_items` table was split out in prod; the
    // core file now defines `invoice_line_items`. Guard against the stale name
    // creeping back in any statement (CREATE TABLE, ALTER, index, policy).
    expect(sql).not.toMatch(/\bline_items\b(?<!invoice_line_items)/);
    expect(sql).toMatch(/CREATE TABLE invoice_line_items\b/);
  });
});
