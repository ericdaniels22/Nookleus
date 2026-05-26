// /referral-partners/[id] — read-only Call Worksheet (PRD #249, issue #252).
//
// The page is a Server Component. It performs three steps and hands off:
//
//   1. Permission gate via `requirePagePermission` with VIEW_REFERRAL_PARTNERS
//      (admin + crew_lead). crew_member is denied here, not by the database.
//   2. Fetch the partner via the User client — RLS scopes the read to the
//      Active Organization, so a partner id from another Org returns no row
//      and the page calls notFound() (matching the platform's cross-tenant
//      pattern in jobs/estimates).
//   3. Fetch the linked Primary / Owner contacts and the full "Contacts at
//      this company" list, then render the read-only Worksheet.
//
// Editing, Lifecycle-status flip buttons, the "Log a call" form, and the
// "+ Add contact" affordance all land in later slices (#4, #5, #6).

import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePagePermission } from "@/lib/request-context/require-page-permission";
import { VIEW_REFERRAL_PARTNERS } from "@/lib/referral-partners/permission";
import {
  ReferralPartnerWorksheet,
  type ReferralPartnerForWorksheet,
  type ReferralContactForWorksheet,
} from "@/components/referral-partners/referral-partner-worksheet";

interface ErrorPageProps {
  title: string;
  message: string;
}

function ErrorPage({ title, message }: ErrorPageProps) {
  return (
    <div className="flex items-center justify-center min-h-[40vh] px-4">
      <div className="rounded-xl border border-border bg-card p-8 text-center max-w-md w-full">
        <AlertCircle size={28} className="mx-auto text-destructive mb-3" />
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{message}</p>
        <Link
          href="/referral-partners"
          className="inline-flex items-center gap-1 mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          <ArrowLeft size={14} />
          Back to Referral Partners
        </Link>
      </div>
    </div>
  );
}

export default async function ReferralPartnerWorksheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  // 1. Permission gate — admin / crew_lead only. crew_member sees the
  //    same ErrorPage an unauthenticated caller does (PRD #249 #24).
  const auth = await requirePagePermission(supabase, VIEW_REFERRAL_PARTNERS);
  if (!auth.ok) {
    return (
      <ErrorPage
        title="Access restricted"
        message="You don't have permission to view Referral Partners."
      />
    );
  }

  // 2. Fetch the partner. RLS scopes to the Active Organization — a cross-
  //    org id (or a soft-deleted partner) resolves to no row and we 404.
  const { data: partner } = await supabase
    .from("referral_partners")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle<ReferralPartnerForWorksheet>();

  if (!partner) notFound();

  // 3. Fetch the contacts surface — the linked Primary + Owner slots and
  //    every Referral Contact at this company. Three parallel reads keep
  //    the page-render path short.
  const [primary, owner, contactsList] = await Promise.all([
    partner.primary_contact_id
      ? supabase
          .from("contacts")
          .select("id, full_name, phone, email")
          .eq("id", partner.primary_contact_id)
          .maybeSingle<ReferralContactForWorksheet>()
          .then((r) => r.data)
      : Promise.resolve(null),
    partner.owner_contact_id
      ? supabase
          .from("contacts")
          .select("id, full_name, phone, email")
          .eq("id", partner.owner_contact_id)
          .maybeSingle<ReferralContactForWorksheet>()
          .then((r) => r.data)
      : Promise.resolve(null),
    supabase
      .from("contacts")
      .select("id, full_name, phone, email")
      .eq("referral_partner_id", id)
      .order("full_name", { ascending: true })
      .then((r) => (r.data ?? []) as ReferralContactForWorksheet[]),
  ]);

  return (
    <>
      <div className="max-w-5xl mx-auto px-4 pt-6">
        <Link
          href="/referral-partners"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Referral Partners
        </Link>
      </div>
      <ReferralPartnerWorksheet
        partner={partner}
        primaryContact={primary}
        ownerContact={owner}
        contacts={contactsList}
      />
    </>
  );
}
