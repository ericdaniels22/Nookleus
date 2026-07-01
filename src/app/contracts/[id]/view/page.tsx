import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { sanitizePdfFilename } from "@/lib/contracts/pdf-filename";
import DownloadPdfButton from "@/components/contracts/download-pdf-button";
import SignedPdfViewerClient from "@/components/contracts/signed-pdf-viewer-client";
import type { Contract } from "@/lib/contracts/types";

export default async function ContractViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const authClient = await createServerSupabaseClient();
  const { data: { user }, error: authErr } = await authClient.auth.getUser();
  if (authErr || !user) {
    redirect(`/login?next=/contracts/${id}/view`);
  }

  const supabase = createServiceClient();
  const { data: contract } = await supabase
    .from("contracts")
    .select("id, job_id, title, status, signed_pdf_path, signed_at, void_reason")
    .eq("id", id)
    .maybeSingle<
      Pick<
        Contract,
        | "id"
        | "job_id"
        | "title"
        | "status"
        | "signed_pdf_path"
        | "signed_at"
        | "void_reason"
      >
    >();

  if (!contract) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-4">
        <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold mb-2 text-foreground">
            Contract not found
          </h1>
          <Link
            href="/contracts"
            className="text-sm text-[var(--brand-primary)] hover:underline"
          >
            Back to contracts
          </Link>
        </div>
      </div>
    );
  }

  if (!contract.signed_pdf_path) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-4">
        <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold mb-2 text-foreground">
            Contract has not been signed yet
          </h1>
          <Link
            href={contract.job_id ? `/jobs/${contract.job_id}` : "/contracts"}
            className="text-sm text-[var(--brand-primary)] hover:underline"
          >
            {contract.job_id ? "Back to job" : "Back to contracts"}
          </Link>
        </div>
      </div>
    );
  }

  const signedLabel = contract.signed_at
    ? new Date(contract.signed_at).toLocaleString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

  const filename = `${sanitizePdfFilename(contract.title)}.pdf`;
  const backHref = contract.job_id ? `/jobs/${contract.job_id}` : "/contracts";

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ArrowLeft size={16} /> Back
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{contract.title}</h1>
            <p className="text-xs text-muted-foreground">
              {contract.status === "voided"
                ? `Voided${contract.void_reason ? ` · ${contract.void_reason}` : ""}`
                : `Signed ${signedLabel}`}
            </p>
          </div>
          <DownloadPdfButton
            pdfUrl={`/api/contracts/${contract.id}/pdf`}
            filename={filename}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
          >
            <Download size={14} /> Download
          </DownloadPdfButton>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4">
        <SignedPdfViewerClient pdfUrl={`/api/contracts/${contract.id}/pdf?inline=1`} />
      </main>
    </div>
  );
}
