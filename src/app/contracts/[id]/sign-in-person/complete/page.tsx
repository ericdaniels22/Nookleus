import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Download, ArrowLeft, Eye } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { sanitizePdfFilename } from "@/lib/contracts/pdf-filename";
import DownloadPdfButton from "@/components/contracts/download-pdf-button";
import type { Contract } from "@/lib/contracts/types";

export default async function SignInPersonCompletePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const authClient = await createServerSupabaseClient();
  const { data: { user }, error: authErr } = await authClient.auth.getUser();
  if (authErr || !user) {
    redirect(`/login?next=/contracts/${id}/sign-in-person/complete`);
  }

  const supabase = createServiceClient();
  const { data: contract } = await supabase
    .from("contracts")
    .select("id, job_id, title, status, signed_pdf_path, signed_at")
    .eq("id", id)
    .maybeSingle<Pick<Contract, "id" | "job_id" | "title" | "status" | "signed_pdf_path" | "signed_at">>();

  if (!contract) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold mb-2 text-foreground">Contract not found</h1>
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

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6 py-10">
      <div className="max-w-xl w-full bg-card border border-border rounded-2xl p-10 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-[rgba(29,158,117,0.15)] flex items-center justify-center mb-5">
          <CheckCircle2 size={40} className="text-[#5DCAA5]" />
        </div>
        <h1 className="text-2xl font-semibold mb-2">Contract signed</h1>
        <p className="text-sm text-muted-foreground mb-1">{contract.title}</p>
        <p className="text-xs text-muted-foreground mb-8">Signed {signedLabel}</p>

        {contract.signed_pdf_path && (
          <Link
            href={`/contracts/${contract.id}/view`}
            className="inline-flex items-center gap-2 text-sm text-[var(--brand-primary)] hover:underline mb-6"
          >
            <Eye size={14} /> View signed PDF
          </Link>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href={`/jobs/${contract.job_id}`}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold border border-border bg-muted/30 hover:bg-muted/60 transition-colors"
          >
            <ArrowLeft size={14} /> Return to Job
          </Link>
          {contract.signed_pdf_path && (
            <DownloadPdfButton
              pdfUrl={`/api/contracts/${contract.id}/pdf`}
              filename={filename}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all"
            >
              <Download size={14} /> Download PDF
            </DownloadPdfButton>
          )}
        </div>
      </div>
    </div>
  );
}
