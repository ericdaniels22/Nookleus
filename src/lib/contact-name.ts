/**
 * Customer-name helpers for the `full_name` migration (issue #110, slice 1).
 *
 * The `contacts` table is moving from separate `first_name` / `last_name`
 * columns to a single `full_name`. During the transition both shapes coexist;
 * these helpers define the one canonical way to convert between them, and the
 * `contacts` coexistence trigger mirrors this exact logic in PL/pgSQL.
 */

export interface NameParts {
  /** Everything before the final space. */
  givenName: string;
  /** The final whitespace-delimited token; empty when the name is one token. */
  familyName: string;
}

/** Collapse leading/trailing and repeated internal whitespace to single spaces. */
function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Split a full name into given/family parts using the last-space rule:
 * everything before the final space is the given name, the remainder is the
 * family name. A single token yields an empty family name.
 *
 * Mirrored by the `contacts` coexistence trigger and used to derive the
 * QuickBooks `GivenName` / `FamilyName` payload fields.
 */
export function splitName(fullName: string): NameParts {
  const normalized = normalizeWhitespace(fullName ?? "");
  if (normalized === "") return { givenName: "", familyName: "" };

  const lastSpace = normalized.lastIndexOf(" ");
  if (lastSpace === -1) return { givenName: normalized, familyName: "" };

  return {
    givenName: normalized.slice(0, lastSpace),
    familyName: normalized.slice(lastSpace + 1),
  };
}

/**
 * Join legacy `first_name` / `last_name` parts into a single full name — the
 * trimmed, single-spaced join, omitting any empty part. This is the exact
 * expression the migration's `full_name` backfill mirrors.
 *
 * Transitional: retired once the legacy columns are dropped (cleanup slice).
 */
export function joinName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [firstName, lastName]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(" ");
}
