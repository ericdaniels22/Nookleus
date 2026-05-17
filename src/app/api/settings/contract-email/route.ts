import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import type { ContractEmailProvider, ContractEmailSettings } from "@/lib/contracts/types";

// The table is effectively a singleton — seeded with one row in the
// build33 migration. If it somehow goes missing we surface a clear error
// rather than inserting a new row silently.
async function getSettings(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("contract_email_settings")
    .select("*")
    .limit(1)
    .maybeSingle<ContractEmailSettings>();
  return { data, error };
}

// GET /api/settings/contract-email
// Logged-in only — previously ungated (recorded for the #78 ungated list).
export const GET = withRequestContext({}, async (_request, ctx) => {
  const { data, error } = await getSettings(ctx.supabase);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "contract_email_settings row missing — did the build33 migration run?" },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
});

// PATCH /api/settings/contract-email
// Logged-in only — previously ungated (recorded for the #78 ungated list).
export const PATCH = withRequestContext({}, async (request, ctx) => {
  const body = (await request.json().catch(() => null)) as Partial<ContractEmailSettings> | null;
  if (!body) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const { data: current, error: fetchErr } = await getSettings(ctx.supabase);
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!current) {
    return NextResponse.json(
      { error: "contract_email_settings row missing — did the build33 migration run?" },
      { status: 500 },
    );
  }

  const patch: Partial<ContractEmailSettings> = {};
  const stringFields: Array<keyof ContractEmailSettings> = [
    "send_from_email",
    "send_from_name",
    "signing_request_subject_template",
    "signing_request_body_template",
    "signed_confirmation_subject_template",
    "signed_confirmation_body_template",
    "signed_confirmation_internal_subject_template",
    "signed_confirmation_internal_body_template",
    "reminder_subject_template",
    "reminder_body_template",
  ];
  for (const f of stringFields) {
    if (typeof body[f] === "string") (patch as Record<string, unknown>)[f] = body[f];
  }
  if (body.reply_to_email === null || typeof body.reply_to_email === "string") {
    patch.reply_to_email = body.reply_to_email || null;
  }
  if (body.provider === "resend" || body.provider === "email_account") {
    patch.provider = body.provider as ContractEmailProvider;
  }
  if (body.email_account_id === null || typeof body.email_account_id === "string") {
    patch.email_account_id = body.email_account_id || null;
  }
  if (Array.isArray(body.reminder_day_offsets)) {
    const offsets = body.reminder_day_offsets
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 60);
    patch.reminder_day_offsets = offsets;
  }
  if (typeof body.default_link_expiry_days === "number") {
    const d = Math.round(body.default_link_expiry_days);
    if (d < 1 || d > 30) {
      return NextResponse.json(
        { error: "default_link_expiry_days must be between 1 and 30" },
        { status: 400 },
      );
    }
    patch.default_link_expiry_days = d;
  }

  if (patch.provider === "email_account" && !patch.email_account_id && !current.email_account_id) {
    return NextResponse.json(
      { error: "Select an email account before switching provider to email_account" },
      { status: 400 },
    );
  }

  const { data, error } = await ctx.supabase
    .from("contract_email_settings")
    .update(patch)
    .eq("id", current.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
});
