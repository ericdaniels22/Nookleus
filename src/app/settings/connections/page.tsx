import { redirect } from "next/navigation";
import { Link2 } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { getGoogleConnection, toConnectionSummary } from "@/lib/google/connection";
import { isGoogleOAuthConfigured } from "@/lib/google/config";
import {
  getWebsiteConnection,
  toConnectionSummary as toWebsiteConnectionSummary,
} from "@/lib/website/connection";
import GoogleConnectionCard from "./google-connection-card";
import WebsiteConnectionCard from "./website-connection-card";

// #615 (PRD #603) — the Connections settings page: where an admin links the
// outside accounts the Marketing Suite runs on. Admin-only, like /marketing.
// Slice ① adds the Google connection; the Website (WordPress) connection (#612)
// adds its card here next.
export const dynamic = "force-dynamic";

export default async function ConnectionsSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orgId = await getActiveOrganizationId(supabase);
  const { data: membership } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle<{ role: string }>();

  if (membership?.role !== "admin") {
    return (
      <div className="max-w-3xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Link2 size={24} /> Connections
          </h1>
        </div>
        <div className="bg-card rounded-xl border border-border p-6">
          <p className="text-sm text-muted-foreground">
            Connections are admin-only. Ask an admin to connect your marketing accounts.
          </p>
        </div>
      </div>
    );
  }

  const service = createServiceClient();
  const conn = orgId ? await getGoogleConnection(service, orgId) : null;
  const websiteConn = orgId ? await getWebsiteConnection(service, orgId) : null;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Link2 size={24} /> Connections
        </h1>
        <p className="text-muted-foreground mt-1">
          Link the outside accounts your marketing runs on. Each connection is
          owned by this company, stored encrypted, and can be disconnected here at
          any time.
        </p>
      </div>

      <div className="space-y-4">
        <GoogleConnectionCard
          initial={toConnectionSummary(conn)}
          configured={isGoogleOAuthConfigured()}
        />
        <WebsiteConnectionCard initial={toWebsiteConnectionSummary(websiteConn)} />
      </div>
    </div>
  );
}
