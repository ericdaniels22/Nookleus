// Helpers for safely composing PostgREST filter expressions when the value
// originates from user input.

// PostgREST's .or() / .and() filters are comma-separated and can include
// parentheses for grouping. A raw user-typed comma or parenthesis would be
// reinterpreted as filter syntax. Wrapping the value in double quotes and
// escaping embedded `"` / `\` is the documented escape for reserved chars.
//
// Use for any .or(...) or .and(...) call whose value contains user input.
// The `%` and `_` characters are intentionally NOT escaped — they remain
// ilike wildcards by design (e.g. user typing `abc%` searches abc-prefix).
//
// Example:
//   const term = escapeOrFilterValue(`%${userInput}%`);
//   query.or(`name.ilike.${term},code.ilike.${term}`);
export function escapeOrFilterValue(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}
