/**
 * Build the Storage path for a photo's flattened annotated render.
 *
 * A UNIQUE path per save (the `token`) is what cache-busts the render: Supabase
 * Storage's CDN keys its cache by path, so re-annotating to a *stable*
 * `-annotated.png` served the previous render until the cache aged out. Varying
 * the path makes every save a guaranteed cache miss — no query-param hack, and
 * `annotated_path` already flows to every `photoUrl()` caller, so nothing
 * downstream changes.
 *
 * Mirrors the original derivation (replace the final extension); paths without an
 * extension are returned unchanged, as before. Storage paths always carry one.
 */
export function buildAnnotatedPath(storagePath: string, token: string): string {
  return storagePath.replace(/\.[^.]+$/, `-annotated-${token}.png`);
}
