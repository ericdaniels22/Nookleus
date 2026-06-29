import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle } from "lucide-react";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePagePermission } from "@/lib/request-context/require-page-permission";
import ShowcaseBuilder from "@/components/showcase-builder";
import type { Photo, Showcase } from "@/lib/types";

// The Job-scoped Showcase builder route (#613). A builder route in the AppShell
// `BUILDER_ROUTE_PATTERNS` sense: the app nav renders as the slim collapsed rail
// beside the editor, the same full-page shape as the Photo Report builder
// (#548). A Showcase is a public-facing story, so it is admin-only — both the
// page (here) and every save route ({ adminOnly: true }). The page fetches the
// live draft + the Job's photos server-side (RLS scopes to the active org) and
// hands them to the client builder, which auto-saves edits through the PUT route.
export default async function ShowcaseBuilderPage({
  params,
}: {
  params: Promise<{ id: string; showcaseId: string }>;
}) {
  const { id: jobId, showcaseId } = await params;
  const supabase = await createServerSupabaseClient();

  const auth = await requirePagePermission(supabase, { adminOnly: true });
  if (!auth.ok) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] px-4">
        <div className="rounded-xl border border-border bg-card p-8 text-center max-w-md w-full">
          <AlertCircle size={28} className="mx-auto text-destructive mb-3" />
          <h2 className="text-lg font-semibold text-foreground">
            Access restricted
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Only an admin can edit a job&apos;s showcase.
          </p>
          <Link
            href="/jobs"
            className="inline-block mt-4 text-sm font-medium text-[#2B5EA7] hover:underline"
          >
            Back to jobs
          </Link>
        </div>
      </div>
    );
  }

  // Only a *live* Showcase is editable — a trashed one (deleted_at set) 404s, so
  // the builder never opens onto a soft-deleted draft. Scoped by both id and
  // job_id so a showcase id from another Job can't be loaded under this Job.
  const { data: showcase } = await supabase
    .from("showcases")
    .select("*")
    .eq("id", showcaseId)
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .maybeSingle<Showcase>();
  if (!showcase) {
    notFound();
  }

  // Load every photo on the Job (not just the ones already chosen) so the builder
  // can add any of them to the gallery. Same ordering as the Job Photos tab:
  // newest captured first, created_at as the tiebreak.
  const { data: photoData } = await supabase
    .from("photos")
    .select("*")
    .eq("job_id", jobId)
    .order("taken_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<Photo[]>();
  const photos: Photo[] = photoData ?? [];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  return (
    <ShowcaseBuilder
      jobId={jobId}
      showcase={showcase}
      photos={photos}
      supabaseUrl={supabaseUrl}
    />
  );
}
