// Decodes the `active_organization_id` claim from a Supabase access-token
// JWT. Pure function — no I/O. Callers that need the token from a session
// pass `session?.access_token` through directly.
//
// Returns `null` when the token is absent, malformed, or carries no claim.
// Reads only `app_metadata.active_organization_id`, the claim injected by
// `public.custom_access_token_hook` at token issuance (18b); other claim
// locations are not honoured here so callers cannot accidentally trust a
// client-controlled top-level `active_organization_id`.

export function resolveActiveOrgId(
  accessToken: string | undefined | null,
): string | null {
  if (!accessToken) return null;
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const decoded =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf-8");
    const payload = JSON.parse(decoded) as {
      app_metadata?: Record<string, unknown>;
    };
    const claim = payload.app_metadata?.active_organization_id;
    return typeof claim === "string" && claim.length > 0 ? claim : null;
  } catch {
    return null;
  }
}
