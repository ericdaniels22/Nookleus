import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/jobs/[id]/contact-email
// Returns the linked contact's email + display name. Used by the payment
// request modal to prefill the Recipient field; callers may override.
// Needs `record_payments` (admins auto-pass) and the Service client to
// read the job + contact regardless of RLS.
export const GET = withRequestContext(
  { permission: "record_payments", serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const supabase = ctx.serviceClient!;

    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("contact_id")
      .eq("id", id)
      .maybeSingle<{ contact_id: string | null }>();
    if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
    if (!job) return NextResponse.json({ error: "job_not_found" }, { status: 404 });

    if (!job.contact_id) {
      return NextResponse.json({ email: null, name: null });
    }

    const { data: contact } = await supabase
      .from("contacts")
      .select("email, full_name")
      .eq("id", job.contact_id)
      .maybeSingle<{
        email: string | null;
        full_name: string | null;
      }>();

    const email = contact?.email ?? null;
    const name = contact?.full_name?.trim() || null;

    return NextResponse.json({ email, name });
  },
);
