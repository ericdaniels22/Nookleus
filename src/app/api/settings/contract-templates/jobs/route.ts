import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/settings/contract-templates/jobs
// Minimal job list used to populate the Preview modal's job picker.
// Returns the 25 most recent jobs with their job_number + customer name
// so the author can eyeball which job the preview is rendering against.
//
// Requires `access_settings` (#107) — tightened from the logged-in-only #84 gate.
export const GET = withRequestContext({ permission: "access_settings" }, async (_request, ctx) => {
  const { data, error } = await ctx.supabase
    .from("jobs")
    .select("id, job_number, property_address, created_at, contact:contacts!contact_id(full_name)")
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type JobRow = {
    id: string;
    job_number: string | null;
    property_address: string | null;
    contact: { full_name: string | null } | { full_name: string | null }[] | null;
  };

  const options = (data ?? []).map((rawRow) => {
    const row = rawRow as JobRow;
    const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
    const customer = contact?.full_name?.trim() ?? "";
    const addr = row.property_address ?? "";
    const prefix = row.job_number ?? row.id.slice(0, 8);
    const trailing = [customer, addr].filter(Boolean).join(" — ");
    return {
      id: row.id,
      label: trailing ? `${prefix} — ${trailing}` : prefix,
    };
  });

  return NextResponse.json(options);
});
