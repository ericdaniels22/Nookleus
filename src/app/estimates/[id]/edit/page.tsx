import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePagePermission } from "@/lib/request-context/require-page-permission";
import { getEstimateWithContents } from "@/lib/estimates";
import { EstimateBuilder } from "@/components/estimate-builder/estimate-builder";
import { JOB_WITH_HOMEOWNER_EMBED } from "@/lib/embeds/jobs-contacts";
import type { Contact, Job } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Local ErrorPage helper — matches Task 19 pattern.
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
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function EstimateEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  // 1. Permission check — must happen before any DB reads.
  const auth = await requirePagePermission(supabase, {
    permission: "edit_estimates",
  });
  if (!auth.ok) {
    return (
      <ErrorPage
        title="Access restricted"
        message="You don't have permission to edit estimates."
        backHref="/jobs"
        backLabel="Back to jobs"
      />
    );
  }

  // 2. Fetch the estimate with its sections + line items.
  const estimate = await getEstimateWithContents(id, supabase);
  if (!estimate) {
    notFound();
  }

  // 2a. Redirect to read-only view if the estimate is in the trash.
  if (estimate.deleted_at) {
    redirect(`/estimates/${id}`);
  }

  // 3. Fetch the parent job with the contact joined.
  //    Destructure error separately (Task 19 lesson: don't swallow lookup errors).
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(JOB_WITH_HOMEOWNER_EMBED)
    .eq("id", estimate.job_id)
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

  if (!job) {
    // FK guarantees this shouldn't happen, but defense-in-depth.
    notFound();
  }

  // 4. Fetch the default_estimate_valid_days setting.
  //    RLS handles org-scoping — no need to call getActiveOrganizationId.
  const { data: validDaysSetting } = await supabase
    .from("company_settings")
    .select("value")
    .eq("key", "default_estimate_valid_days")
    .maybeSingle();
  const defaultValidDays = parseInt(validDaysSetting?.value ?? "30", 10) || 30;

  // 5. Fetch the default opening + closing statement settings.
  const { data: openingSetting } = await supabase
    .from("company_settings")
    .select("value")
    .eq("key", "default_estimate_opening_statement")
    .maybeSingle();
  const { data: closingSetting } = await supabase
    .from("company_settings")
    .select("value")
    .eq("key", "default_estimate_closing_statement")
    .maybeSingle();
  const defaultOpeningStatement: string = openingSetting?.value ?? "";
  const defaultClosingStatement: string = closingSetting?.value ?? "";

  // 6. Hand off to the client-component state container.
  return (
    <EstimateBuilder
      entity={{ kind: "estimate", data: estimate }}
      job={job}
      defaultValidDays={defaultValidDays}
      defaultOpeningStatement={defaultOpeningStatement}
      defaultClosingStatement={defaultClosingStatement}
    />
  );
}
