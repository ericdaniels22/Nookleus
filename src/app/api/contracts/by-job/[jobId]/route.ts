import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { belongsToActiveOrganization } from "@/lib/request-context/belongs-to-active-organization";
import type { ContractListItem } from "@/lib/contracts/types";

interface DbRow {
  id: string;
  title: string;
  status: string;
  sent_at: string | null;
  first_viewed_at: string | null;
  signed_at: string | null;
  link_expires_at: string | null;
  void_reason: string | null;
  signed_pdf_path: string | null;
  reminder_count: number;
  next_reminder_at: string | null;
  created_at: string;
  signers: Array<{
    id: string;
    signer_order: number;
    name: string | null;
    role_label: string | null;
    signed_at: string | null;
    ip_address: string | null;
  }>;
}

// GET /api/contracts/by-job/[jobId] — contracts for the Contracts section
// on the job detail Overview tab. Build 15c extends the returned shape
// with per-signer status (for multi-signer sequential UI) and the auto-
// reminder counters (for the "reminders sent: N" indicator on the job
// header).
//
// Requires `view_jobs` (#106) — a contract is a job sub-resource, so the
// contracts area is gated on the job permissions. The `jobId` is caller-
// supplied, so the route also runs it through the #97 Active-Organization
// scoping guard before the read: a job in another Organization is
// indistinguishable from a missing one (both 404).
export const GET = withRequestContext(
  { permission: "view_jobs" },
  async (_req, ctx, { params }: { params: Promise<{ jobId: string }> }) => {
    const { jobId } = await params;
    const supabase = ctx.supabase;

    if (!(await belongsToActiveOrganization(supabase, { jobId }, ctx.orgId))) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("contracts")
      .select(
        `id, title, status, sent_at, first_viewed_at, signed_at,
         link_expires_at, void_reason, signed_pdf_path, reminder_count,
         next_reminder_at, created_at,
         signers:contract_signers(id, signer_order, name, role_label, signed_at, ip_address)`,
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows: ContractListItem[] = (data ?? []).map((row) => {
      const r = row as unknown as DbRow;
      const ordered = [...(r.signers ?? [])].sort(
        (a, b) => a.signer_order - b.signer_order,
      );
      const primary = ordered[0];
      return {
        id: r.id,
        title: r.title,
        status: r.status as ContractListItem["status"],
        sent_at: r.sent_at,
        first_viewed_at: r.first_viewed_at,
        signed_at: r.signed_at,
        link_expires_at: r.link_expires_at,
        void_reason: r.void_reason,
        signed_pdf_path: r.signed_pdf_path,
        primary_signer_name: primary?.name ?? null,
        primary_signer_ip: primary?.ip_address ?? null,
        signer_count: ordered.length,
        signers: ordered.map((s) => ({
          id: s.id,
          signer_order: s.signer_order,
          name: s.name,
          role_label: s.role_label,
          signed_at: s.signed_at,
        })),
        reminder_count: r.reminder_count ?? 0,
        next_reminder_at: r.next_reminder_at,
        created_at: r.created_at,
      };
    });
    return NextResponse.json(rows);
  },
);
