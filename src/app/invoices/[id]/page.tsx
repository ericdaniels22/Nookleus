import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getInvoiceWithContents } from "@/lib/invoices";
import { loadStripeConnection } from "@/lib/stripe";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import InvoiceReadOnlyClient from "@/components/invoices/invoice-read-only-client";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const inv = await getInvoiceWithContents(supabase, id);
  if (!inv) notFound();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, job_number, property_address, contact_id, contacts:contact_id(full_name, email)",
    )
    .eq("id", inv.job_id)
    .maybeSingle();

  // Stripe-connected check — Build 17 helper. loadStripeConnection returns
  // StripeConnectionRow | null. Org-scoped — needs the active org.
  const orgId = await getActiveOrganizationId(supabase);
  const stripeConnected = orgId
    ? (await loadStripeConnection(orgId)) !== null
    : false;

  return (
    <InvoiceReadOnlyClient
      invoice={{ ...inv, job: (job as unknown as InvoiceReadOnlyClientJob) ?? null }}
      stripeConnected={stripeConnected}
      isTrashed={!!inv.deleted_at}
      deletedAt={inv.deleted_at ?? undefined}
    />
  );
}

// Local type alias — narrowed shape we're handing to the client.
// PostgREST's inferred type for the `contacts:contact_id(...)` join can be
// either an array or a singleton depending on the codegen path; cast through
// `unknown` to the actual runtime singleton shape.
type InvoiceReadOnlyClientJob = {
  id: string;
  job_number: string;
  property_address: string | null;
  contacts: {
    full_name: string | null;
    email: string | null;
  } | null;
};
