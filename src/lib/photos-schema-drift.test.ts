import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Drift guard for the photo-system schema snapshot (issue #412).
 *
 * Every photo-domain table in production carries an `organization_id`
 * (uuid NOT NULL, FK -> organizations) for multi-tenant isolation. The
 * snapshot in `supabase/schema-photos.sql` had drifted and omitted it on all
 * six tables. This test fails if any photo table's CREATE TABLE block stops
 * declaring `organization_id`, catching a future re-drift before it ships.
 *
 * Vitest runs with the repo root as cwd, so the snapshot resolves relative to
 * `process.cwd()`.
 */
const SCHEMA_PATH = path.join(process.cwd(), "supabase", "schema-photos.sql");

const PHOTO_TABLES = [
  "photos",
  "photo_tags",
  "photo_tag_assignments",
  "photo_annotations",
  "photo_report_templates",
  "photo_reports",
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
    throw new Error(
      `No CREATE TABLE block found for "${table}" in schema-photos.sql`
    );
  }
  return match[1];
}

describe("schema-photos.sql multi-tenant drift guard", () => {
  const sql = readFileSync(SCHEMA_PATH, "utf8");

  it.each(PHOTO_TABLES)(
    "declares organization_id on the %s table",
    (table) => {
      const block = createTableBlock(sql, table);
      expect(block).toMatch(/\borganization_id\b/);
    }
  );
});
