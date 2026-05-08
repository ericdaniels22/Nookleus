import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { generateEstimateNumber } from "@/lib/estimates";
import type { Estimate } from "@/lib/types";

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

export default async function NewEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: jobId } = await params;
  const supabase = await createServerSupabaseClient();

  // 1. Permission check — must happen before any data work.
  const auth = await requirePermission(supabase, "create_estimates");
  if (!auth.ok) {
    return (
      <ErrorPage
        title="Access restricted"
        message="You don't have permission to create estimates."
        backHref={`/jobs/${jobId}`}
        backLabel="Back to job"
      />
    );
  }

  // 2. Verify the job exists and belongs to the active org (RLS enforces org scope).
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .maybeSingle<{ id: string }>();

  if (jobErr) {
    return (
      <ErrorPage
        title="Could not load job"
        message={jobErr.message}
        backHref={`/jobs/${jobId}`}
        backLabel="Back to job"
      />
    );
  }
  if (!job) {
    return (
      <ErrorPage
        title="Job not found"
        message="This job doesn't exist or you don't have access to it."
        backHref="/jobs"
        backLabel="Back to jobs"
      />
    );
  }

  // 3. Get the active organization id.
  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) {
    return (
      <ErrorPage
        title="No active organization"
        message="Could not determine your active organization. Try switching workspaces."
        backHref={`/jobs/${jobId}`}
        backLabel="Back to job"
      />
    );
  }

  // 4. Fetch the default title from company settings (mirrors the API route).
  const { data: setting } = await supabase
    .from("company_settings")
    .select("value")
    .eq("organization_id", orgId)
    .eq("key", "default_estimate_title")
    .maybeSingle();
  const title = (setting?.value as string | null | undefined) || "Estimate";

  // 5a. Generate the atomic estimate number via RPC (throws on RPC failure).
  let numbered: { estimate_number: string; sequence_number: number };
  try {
    numbered = await generateEstimateNumber(jobId, supabase);
  } catch (err) {
    return (
      <ErrorPage
        title="Could not assign estimate number"
        message={err instanceof Error ? err.message : "Unexpected error"}
        backHref={`/jobs/${jobId}`}
        backLabel="Back to job"
      />
    );
  }

  // 5b. Insert the estimate — supabase-js v2 returns {data, error}; does not throw.
  const { data: estimate, error: insertError } = await supabase
    .from("estimates")
    .insert({
      organization_id: orgId,
      job_id: jobId,
      estimate_number: numbered.estimate_number,
      sequence_number: numbered.sequence_number,
      title,
      status: "draft",
      created_by: auth.userId,
    })
    .select("*")
    .single<Estimate>();

  if (insertError || !estimate) {
    const msg = insertError?.message ?? "Unknown error";
    return (
      <ErrorPage
        title="Failed to save estimate"
        message={`Failed to save estimate: ${msg}`}
        backHref={`/jobs/${jobId}`}
        backLabel="Back to job"
      />
    );
  }

  // 6. Redirect to the editor — redirect() throws internally; call outside try/catch.
  redirect(`/estimates/${estimate.id}/edit`);
}
