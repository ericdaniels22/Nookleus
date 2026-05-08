import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getInvoiceWithContents } from "@/lib/invoices";
import { EstimateBuilder } from "@/components/estimate-builder/estimate-builder";
import type { Contact, Job } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Local ErrorPage helper — matches the estimate-edit page pattern.
// Cleanup into a shared component can come once all builder pages exist.
// ─────────────────────────────────────────────────────────────────────────────

interface ErrorPageProps {
  title: string;
  message: string;
  backHref: string;
  backLabel: string;
}

function ErrorPage({ title, message, backHref, backLabel }: ErrorPageProps) {
  return (
    <div className="flex items-center justify-center min-h-[40vh] px-4">
      <div className="rounded-xl border border-border bg-card p-8 text-center max-w-md w-full">
        <AlertCircle size={28} className="mx-auto text-destructive mb-3" />
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{message}</p>
        <Link
          href={backHref}
          className="inline-block mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          {backLabel}
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page — renders <EstimateBuilder> in invoice mode (Task 43).
// ─────────────────────────────────────────────────────────────────────────────

export default async function InvoiceEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  // 1. Permission check — must happen before any DB reads.
  const auth = await requirePermission(supabase, "edit_invoices");
  if (!auth.ok) {
    return (
      <ErrorPage
        title="Access restricted"
        message="You don't have permission to edit invoices."
        backHref="/jobs"
        backLabel="Back to jobs"
      />
    );
  }

  // 2. Fetch the invoice with its sections + line items.
  const inv = await getInvoiceWithContents(supabase, id);
  if (!inv) {
    notFound();
  }

  // 2a. Redirect to read-only view if the invoice is in the trash.
  if (inv.deleted_at) {
    redirect(`/invoices/${id}`);
  }

  // 3. Fetch the parent job + contact for the customer block.
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("*, contact:contacts(*)")
    .eq("id", inv.job_id)
    .maybeSingle<Job & { contact: Contact | null }>();

  if (jobErr) {
    return (
      <ErrorPage
        title="Could not load job"
        message={jobErr.message}
        backHref="/jobs"
        backLabel="Back to jobs"
      />
    );
  }

  // 4. Hand off to the client-component state container.
  return (
    <EstimateBuilder
      entity={{ kind: "invoice", data: inv }}
      job={job ?? null}
    />
  );
}
