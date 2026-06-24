import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContractEmailSettings } from "./types";

// One bundle of everything the branded card needs, so the send paths resolve
// branding once instead of each re-querying company_settings (#691).
export interface EmailBranding {
  companyName: string | null;
  logoUrl: string | null;
  buttonLabel: string;
  buttonColor: string;
  logoVisible: boolean;
}

// Resolves a company_settings logo object path to its public URL via the
// public `company-assets` bucket. String-concat (not getPublicUrl) keeps this
// unit-testable against the supabase-fake and matches how the rest of the app
// builds company-asset URLs.
function logoPathToUrl(logoPath: string | null): string | null {
  if (!logoPath) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/company-assets/${logoPath}`;
}

/**
 * Loads the branded-card content for an organization: company name + logo
 * from company_settings, plus the style knobs off the already-fetched
 * contract_email_settings row. Returned as one bundle so a send path doesn't
 * re-query for branding.
 *
 * Note: the canonical logo key is `logo_path` (a storage object path), NOT
 * `logo_url` — the older loadCompanyMap reads `logo_url`, a key that is never
 * written, so it always yields a null logo. This reads the real key.
 */
export async function loadEmailBranding(
  supabase: SupabaseClient,
  organizationId: string,
  settings: ContractEmailSettings,
): Promise<EmailBranding> {
  const { data: rows } = await supabase
    .from("company_settings")
    .select("key, value")
    .eq("organization_id", organizationId)
    .in("key", ["company_name", "logo_path"]);

  const map = new Map<string, string | null>(
    ((rows ?? []) as { key: string; value: string | null }[]).map((r) => [
      r.key,
      r.value,
    ]),
  );

  return {
    companyName: map.get("company_name") || null,
    logoUrl: logoPathToUrl(map.get("logo_path") ?? null),
    buttonLabel: settings.button_label,
    buttonColor: settings.button_color,
    logoVisible: settings.logo_visible,
  };
}
