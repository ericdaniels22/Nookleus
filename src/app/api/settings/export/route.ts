import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

function toCsv(data: Record<string, unknown>[]): string {
  if (data.length === 0) return "";
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers.map((h) => {
      const val = row[h];
      const str = val === null || val === undefined ? "" : String(val);
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

// GET /api/settings/export?type=jobs&startDate=...&endDate=...
// Requires `access_settings` (#107) — tightened from the logged-in-only #84
// gate. This route dumps jobs/contacts/payments/invoices/emails/activities as
// CSV, so it must not be callable by an arbitrary member.
export const GET = withRequestContext({ permission: "access_settings" }, async (request, ctx) => {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!type) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }

  let query;
  let filename: string;

  switch (type) {
    case "jobs": {
      query = ctx.supabase.from("jobs").select("job_number, status, urgency, damage_type, damage_source, property_address, property_type, property_sqft, affected_areas, insurance_company, claim_number, created_at");
      filename = "jobs.csv";
      break;
    }
    case "contacts": {
      query = ctx.supabase.from("contacts").select("full_name, phone, email, role, company, notes, created_at");
      filename = "contacts.csv";
      break;
    }
    case "payments": {
      query = ctx.supabase.from("payments").select("job_id, source, method, amount, reference_number, payer_name, status, notes, received_date, created_at");
      filename = "payments.csv";
      break;
    }
    case "invoices": {
      query = ctx.supabase.from("invoices").select("invoice_number, job_id, total_amount, status, issued_date, notes, created_at");
      filename = "invoices.csv";
      break;
    }
    case "emails": {
      query = ctx.supabase.from("emails").select("folder, from_address, from_name, subject, snippet, is_read, has_attachments, matched_by, received_at");
      filename = "emails.csv";
      break;
    }
    case "activities": {
      query = ctx.supabase.from("job_activities").select("job_id, activity_type, title, description, author, created_at");
      filename = "activities.csv";
      break;
    }
    default:
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  // Apply date range filter
  if (startDate) query = query.gte("created_at", startDate);
  if (endDate) query = query.lte("created_at", endDate + "T23:59:59");

  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const csv = toCsv((data || []) as Record<string, unknown>[]);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
