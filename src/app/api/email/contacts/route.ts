import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { escapeOrFilterValue } from "@/lib/postgrest";

// GET /api/email/contacts?q=search — autocomplete contacts + recent email addresses
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";
  const supabase = await createServerSupabaseClient();

  const results: { email: string; name: string }[] = [];
  const seen = new Set<string>();

  // 1. Search contacts table
  if (q.length >= 1) {
    const term = escapeOrFilterValue(`%${q}%`);
    const { data: contacts } = await supabase
      .from("contacts")
      .select("first_name, last_name, email")
      .not("email", "is", null)
      .or(`email.ilike.${term},first_name.ilike.${term},last_name.ilike.${term}`)
      .limit(10);

    if (contacts) {
      for (const c of contacts) {
        if (c.email && !seen.has(c.email.toLowerCase())) {
          seen.add(c.email.toLowerCase());
          results.push({
            email: c.email,
            name: `${c.first_name} ${c.last_name}`.trim(),
          });
        }
      }
    }
  }

  // 2. Search previously emailed addresses from emails table
  if (q.length >= 2) {
    const { data: fromEmails } = await supabase
      .from("emails")
      .select("from_address, from_name")
      .ilike("from_address", `%${q}%`)
      .order("received_at", { ascending: false })
      .limit(50);

    if (fromEmails) {
      for (const e of fromEmails) {
        if (e.from_address && !seen.has(e.from_address.toLowerCase())) {
          seen.add(e.from_address.toLowerCase());
          results.push({
            email: e.from_address,
            name: e.from_name || "",
          });
          if (results.length >= 15) break;
        }
      }
    }
  }

  return NextResponse.json(results.slice(0, 15));
}
