import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Drift guard for the email-system schema snapshot (issue #430).
 *
 * Production's email family was reshaped by the Build 42–58 multi-tenancy work
 * and the later email builds: `job_emails` became `emails`, three sibling
 * tables joined it (`email_attachments`, `email_folder_state`,
 * `email_signatures`), every table gained an `organization_id` (uuid NOT NULL,
 * FK -> organizations), and the transitional open RLS policies were replaced by
 * real per-tenant, shared-vs-personal, and parent-tracking policies.
 *
 * The snapshot in `supabase/schema-email.sql` had drifted to the pre-tenancy
 * shape (only `email_accounts` + `job_emails`, both open RLS). These tests fail
 * if the snapshot regresses back toward that shape, catching a future re-drift
 * before it ships. They assert the snapshot's text — the column-for-column
 * reconciliation against the live DB was done by hand in #430.
 *
 * Vitest runs with the repo root as cwd, so the snapshot resolves relative to
 * `process.cwd()`.
 */
const SCHEMA_PATH = path.join(process.cwd(), "supabase", "schema-email.sql");

const EMAIL_TABLES = [
  "email_accounts",
  "emails",
  "email_attachments",
  "email_folder_state",
  "email_signatures",
] as const;

/**
 * Return the body of `CREATE TABLE <table> ( ... );` from the snapshot. The
 * statement terminator is a line-leading `);`; mid-column parens
 * (`gen_random_uuid()`, `CHECK (... )`) never sit at the start of a line, so a
 * non-greedy match stops at the real table terminator. The trailing `\\s*\\(`
 * keeps `emails` from matching the `email_accounts`/`email_attachments` prefix.
 */
function createTableBlock(sql: string, table: string): string {
  const match = sql.match(
    new RegExp(`CREATE TABLE ${table}\\s*\\(([\\s\\S]*?)\\n\\);`),
  );
  if (!match) {
    throw new Error(
      `No CREATE TABLE block found for "${table}" in schema-email.sql`,
    );
  }
  return match[1];
}

describe("schema-email.sql multi-tenant drift guard", () => {
  const sql = readFileSync(SCHEMA_PATH, "utf8");

  it.each(EMAIL_TABLES)("defines the %s table", (table) => {
    expect(() => createTableBlock(sql, table)).not.toThrow();
  });

  it.each(EMAIL_TABLES)(
    "declares organization_id on the %s table",
    (table) => {
      const block = createTableBlock(sql, table);
      expect(block).toMatch(/\borganization_id\b/);
    },
  );

  it("no longer defines the renamed-away job_emails table", () => {
    expect(sql).not.toMatch(/CREATE TABLE job_emails\b/);
  });

  it("does not fall back to transitional open RLS policies", () => {
    expect(sql).not.toMatch(/Allow all/);
  });
});
