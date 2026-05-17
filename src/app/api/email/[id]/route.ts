import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/email/[id] — get a single email.
// Previously ungated (relied on RLS via the User client); now logged-in
// only. Recorded for the #78 ungated-endpoint list.
export const GET = withRequestContext(
  {},
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from("emails")
      .select("*, job:jobs(id, job_number, property_address), attachments:email_attachments(*)")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  },
);

// PATCH /api/email/[id] — update email (read, starred, job_id).
export const PATCH = withRequestContext(
  {},
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (typeof body.is_read === "boolean") updates.is_read = body.is_read;
    if (typeof body.is_starred === "boolean") updates.is_starred = body.is_starred;
    if (body.job_id !== undefined) {
      updates.job_id = body.job_id || null;
      updates.matched_by = body.job_id ? "manual" : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from("emails")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  },
);
