import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { escapeOrFilterValue } from "@/lib/postgrest";

// GET /api/email/contacts?q=search — autocomplete contacts + recent email addresses.
// Previously ungated (relied on RLS via the User client); now logged-in
// only. Recorded for the #78 ungated-endpoint list.
export const GET = withRequestContext({}, async (request, ctx) => {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";

  const results: { email: string; name: string }[] = [];
  const seen = new Set<string>();

  // 1. Search contacts table
  if (q.length >= 1) {
    const term = escapeOrFilterValue(`%${q}%`);
    const { data: contacts } = await ctx.supabase
      .from("contacts")
      .select("full_name, email")
      .not("email", "is", null)
      .or(`email.ilike.${term},full_name.ilike.${term}`)
      .limit(10);

    if (contacts) {
      for (const c of contacts) {
        if (c.email && !seen.has(c.email.toLowerCase())) {
          seen.add(c.email.toLowerCase());
          results.push({
            email: c.email,
            name: c.full_name?.trim() ?? "",
          });
        }
      }
    }
  }

  // 2. Search previously emailed addresses from emails table
  if (q.length >= 2) {
    const { data: fromEmails } = await ctx.supabase
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
});
