// src/app/jobs/[id]/invoices/new/page.tsx
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createInvoice } from "@/lib/invoices";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

export default async function NewInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);
  // Standard null-guard: getActiveOrganizationId returns string | null;
  // createInvoice's 2nd arg is strict string. Same pattern as Tasks 14/16-25.
  if (!orgId) {
    throw new Error("No active organization");
  }
  const inv = await createInvoice(supabase, orgId, { jobId, title: "Invoice" });
  redirect(`/invoices/${inv.id}/edit`);
}
