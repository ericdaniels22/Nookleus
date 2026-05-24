import { redirect } from "next/navigation";
import { Link2 } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveConnection } from "@/lib/qb/tokens";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import AccountingSettingsClient from "../accounting/accounting-settings-client";

// #230 — server-component shell for the QuickBooks tab of the combined
// /settings/money page. Mirrors what /settings/accounting/page.tsx used
// to do: same admin / access_settings / manage_accounting gate, same
// service-client `getActiveConnection` fetch, same prop shape passed to
// `AccountingSettingsClient`. The difference is that under the redesign
// users without QB-specific access can still see the other three Money
// tabs (Vendors, Expense Categories, Stripe); only the QB tab body shows
// the no-access notice.

export async function QuickbooksTab() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("user_organizations")
    .select("id, role")
    .eq("user_id", user.id)
    .eq("organization_id", await getActiveOrganizationId(supabase))
    .maybeSingle<{ id: string; role: string }>();
  const isAdmin = membership?.role === "admin";

  let canAccess = isAdmin;
  if (!canAccess && membership) {
    const { data: perms } = await supabase
      .from("user_organization_permissions")
      .select("permission_key, granted")
      .eq("user_organization_id", membership.id)
      .in("permission_key", ["access_settings", "manage_accounting"]);
    const ok = new Set((perms ?? []).filter((p) => p.granted).map((p) => p.permission_key));
    canAccess = ok.has("access_settings") && ok.has("manage_accounting");
  }

  // Pre-redesign behavior was a hard redirect to /settings/company when
  // canAccess was false. Under the combined page we can't redirect from a
  // single tab, so the tab body shows a no-access notice instead. The
  // other tabs continue to render.
  if (!canAccess) {
    return (
      <div className="max-w-3xl">
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold text-foreground flex items-center gap-2">
            <Link2 size={24} /> QuickBooks Integration
          </h1>
        </div>
        <div className="bg-card rounded-xl border border-border p-6">
          <p className="text-sm text-muted-foreground">
            You don&apos;t have permission to manage the QuickBooks integration.
            Ask an admin to grant the <span className="font-mono">manage_accounting</span> permission.
          </p>
        </div>
      </div>
    );
  }

  const service = createServiceClient();
  const conn = await getActiveConnection(service);

  return (
    <AccountingSettingsClient
      initialConnection={
        conn
          ? {
              id: conn.id,
              company_name: conn.company_name,
              realm_id: conn.realm_id,
              sync_start_date: conn.sync_start_date,
              setup_completed_at: conn.setup_completed_at,
              dry_run_mode: conn.dry_run_mode,
              is_active: conn.is_active,
              last_sync_at: conn.last_sync_at,
              refresh_token_expires_at: conn.refresh_token_expires_at,
            }
          : null
      }
    />
  );
}
