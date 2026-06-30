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

/**
 * Issue #808 — annotation author attribution.
 *
 * `photo_annotations.created_by` used to default to the literal 'Eric'. It is
 * now stamped explicitly with the signed-in user (resolvePhotoAuthor) on the
 * first save, so the schema must NOT carry a DEFAULT — an omitted write should
 * fail the NOT NULL constraint loudly rather than silently re-attribute to
 * 'Eric'. This guards against the snapshot (and, by mirror, prod) re-drifting
 * back to a default.
 */
describe("schema-photos.sql annotation author drift guard (#808)", () => {
  const sql = readFileSync(SCHEMA_PATH, "utf8");

  it("does not default photo_annotations.created_by, but keeps it NOT NULL", () => {
    const block = createTableBlock(sql, "photo_annotations");
    // The column definition only — strip any trailing `-- ...` comment so the
    // guard reads the SQL, not prose that happens to mention "default".
    const createdByDef = (
      block.split("\n").find((l) => /\bcreated_by\b/.test(l)) ?? ""
    ).split("--")[0];
    expect(createdByDef).toMatch(/\bcreated_by\b/);
    expect(createdByDef).toMatch(/NOT NULL/i);
    expect(createdByDef).not.toMatch(/DEFAULT/i);
  });
});

/**
 * Issue #832 — extend the #808 attribution fix to the remaining photo-domain
 * tables that carried a `created_by text NOT NULL DEFAULT 'Eric'`:
 *
 *   - photo_report_templates — the template builder now stamps the resolved
 *     signed-in user (resolvePhotoAuthor) on insert.
 *   - photo_reports — already stamped explicitly (created_by: preparerName), so
 *     its default was vestigial; dropped for consistency + loud failure.
 *   - photo_tags — has no application write path at all; dropping the default
 *     forces any future tag seeder to attribute explicitly rather than silently
 *     crediting 'Eric'.
 *
 * Each keeps NOT NULL so an omitted write fails loudly instead of re-attributing
 * to 'Eric'. This guards the snapshot (and, by mirror, prod) against re-drifting.
 */
describe("schema-photos.sql author drift guard (#832)", () => {
  const sql = readFileSync(SCHEMA_PATH, "utf8");

  const TABLES = [
    "photo_report_templates",
    "photo_reports",
    "photo_tags",
  ] as const;

  it.each(TABLES)(
    "does not default %s.created_by, but keeps it NOT NULL",
    (table) => {
      const block = createTableBlock(sql, table);
      const createdByDef = (
        block.split("\n").find((l) => /\bcreated_by\b/.test(l)) ?? ""
      ).split("--")[0];
      expect(createdByDef).toMatch(/\bcreated_by\b/);
      expect(createdByDef).toMatch(/NOT NULL/i);
      expect(createdByDef).not.toMatch(/DEFAULT/i);
    },
  );
});

/**
 * Issue #848 — one markup row per Photo.
 *
 * `photo_annotations` must carry a UNIQUE index on `photo_id`, so a Photo can
 * never accumulate two annotation rows for save and load to disagree about. The
 * persist path (persistPhotoMarkup) relies on this constraint to make its
 * first-time `upsert(..., { onConflict: 'photo_id' })` converge concurrent
 * saves onto one row. This guards the snapshot (and, by mirror, prod) against
 * re-drifting back to a plain non-unique index.
 */
describe("schema-photos.sql one-markup-row-per-photo drift guard (#848)", () => {
  const sql = readFileSync(SCHEMA_PATH, "utf8");

  // Strip line comments so prose mentioning "index" can't satisfy the guard.
  const ddl = sql
    .split("\n")
    .map((l) => l.split("--")[0])
    .join("\n");

  it("declares a UNIQUE index on photo_annotations(photo_id)", () => {
    expect(ddl).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+\w+\s+ON\s+photo_annotations\s*\(\s*photo_id\s*\)/i,
    );
  });

  it("does not also carry a redundant non-unique index on photo_annotations(photo_id)", () => {
    // A plain CREATE INDEX (no UNIQUE) over the same single column would be dead
    // weight once the unique index exists — and a signal the change was added
    // rather than replacing the old idx_photo_annotations_photo_id.
    expect(ddl).not.toMatch(
      /CREATE\s+INDEX\s+\w+\s+ON\s+photo_annotations\s*\(\s*photo_id\s*\)/i,
    );
  });
});
