/**
 * Customer-name helper.
 *
 * The `contacts` table stores a single `full_name` column (PRD #109). The one
 * remaining consumer of a split name is the QuickBooks sync, which needs
 * `GivenName` / `FamilyName` — `splitName` defines the canonical way to derive
 * them. The transitional `joinName` helper and the coexistence trigger were
 * removed in the cleanup slice (issue #115).
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
 * Used to derive the QuickBooks `GivenName` / `FamilyName` payload fields.
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
