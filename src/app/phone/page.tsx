import Link from "next/link";
import { AlertCircle, Phone as PhoneIcon } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePagePermission } from "@/lib/request-context/require-page-permission";

// PRD #304 — Nookleus Phone. Slice 2 (#306) — the tracer slice.
//
// This is the empty-state surface for the future Phone tab. No Twilio,
// no data fetching, no realtime — just the gate, the route, and the empty
// state. Future slices replace the empty state with the iMessage-style
// two-pane Conversations / thread view.
//
// Gate: `view_phone` (PRD #304 § Permission). Denial follows the shared
// ErrorPage pattern used by estimates/[id], invoices/[id], and
// referral-partners/[id] — the codebase's standard unauthorized response.

export default async function PhonePage() {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePagePermission(supabase, {
    permission: "view_phone",
  });

  if (!auth.ok) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] px-4">
        <div className="rounded-xl border border-border bg-card p-8 text-center max-w-md w-full">
          <AlertCircle size={28} className="mx-auto text-destructive mb-3" />
          <h2 className="text-lg font-semibold text-foreground">Access restricted</h2>
          <p className="text-sm text-muted-foreground mt-1">
            You don&apos;t have permission to view the Phone tab.
          </p>
          <Link
            href="/"
            className="inline-block mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="text-center max-w-md">
        <PhoneIcon size={40} className="mx-auto text-muted-foreground mb-4" />
        <h1 className="text-lg font-semibold text-foreground">Phone</h1>
        <p className="text-sm text-muted-foreground mt-2">
          No conversations yet — text or call a Contact to get started.
        </p>
      </div>
    </div>
  );
}
