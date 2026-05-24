import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveConnection } from "@/lib/qb/tokens";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import SetupWizardClient from "./setup-wizard-client";

// Server gate + bootstrapping. Loads the damage_types list (platform
// values) so the wizard can build the mapping rows synchronously on first
// paint. QB Classes / Accounts are fetched client-side (separate round
// trips because they talk to QBO).
export default async function AccountingSetupPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orgId = await getActiveOrganizationId(supabase);
  const { data: membership } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle<{ role: string }>();
  if (membership?.role !== "admin") redirect("/settings/money?tab=quickbooks");

  const service = createServiceClient();
  const conn = await getActiveConnection(service);
  if (!conn) redirect("/settings/money?tab=quickbooks");

  const { data: damageTypes } = await service
    .from("damage_types")
    .select("name, display_label")
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order("sort_order", { ascending: true });

  return (
    <SetupWizardClient
      connection={{
        id: conn.id,
        company_name: conn.company_name,
        realm_id: conn.realm_id,
        sync_start_date: conn.sync_start_date,
        setup_completed_at: conn.setup_completed_at,
        dry_run_mode: conn.dry_run_mode,
      }}
      damageTypes={(damageTypes ?? []) as Array<{ name: string; display_label: string }>}
    />
  );
}
