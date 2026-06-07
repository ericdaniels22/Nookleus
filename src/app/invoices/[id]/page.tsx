import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePagePermission } from "@/lib/request-context/require-page-permission";
import { getInvoiceWithContents } from "@/lib/invoices";
import { loadStripeConnection } from "@/lib/stripe";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { getDefaultPreset } from "@/lib/pdf-presets";
import { isLayoutLocked, resolveEffectiveLayout } from "@/lib/pdf-layout";
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

  // Edit permission for the live layout panel (ADR 0012 / #485): the panel only
  // accepts edits from callers who hold edit_invoices, matching the PATCH route.
  const editAuth = await requirePagePermission(supabase, {
    permission: "edit_invoices",
  });
  const canEdit = editAuth.ok;

  // Resolve the document's effective look (ADR 0012 precedence: the document's
  // own snapshot → Organization default preset → field defaults) so the panel's
  // toggles restore the current state. Read-only once the invoice is frozen
  // (paid or voided, ADR 0007) or trashed — matching the PATCH route's 409/404.
  const preset = await getDefaultPreset(supabase, "invoice");
  const effectiveLayout = resolveEffectiveLayout(inv.pdf_layout, preset);
  const layoutLocked =
    isLayoutLocked("invoice", inv.status) || Boolean(inv.deleted_at);

  return (
    <InvoiceReadOnlyClient
      invoice={{ ...inv, job: (job as unknown as InvoiceReadOnlyClientJob) ?? null }}
      stripeConnected={stripeConnected}
      isTrashed={!!inv.deleted_at}
      deletedAt={inv.deleted_at ?? undefined}
      layout={effectiveLayout}
      canEdit={canEdit}
      locked={layoutLocked}
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
