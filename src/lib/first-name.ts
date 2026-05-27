/**
 * Returns the first whitespace-delimited token of a full name. Used by the
 * dashboard greeting; `'Ana Maria Garcia' → 'Ana'` is a known limitation
 * (issue #292).
 */
export function getFirstName(fullName: string | null | undefined): string {
  if (fullName == null) return "";
  const trimmed = fullName.trim();
  if (trimmed === "") return "";
  const firstSpace = trimmed.indexOf(" ");
  return firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
}
