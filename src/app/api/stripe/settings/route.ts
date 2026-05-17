import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

interface SettingsPatch {
  ach_enabled?: boolean;
  card_enabled?: boolean;
  pass_card_fee_to_customer?: boolean;
  card_fee_percent?: number;
  ach_preferred_threshold?: number | null;
  default_statement_descriptor?: string | null;
  surcharge_disclosure?: string | null;
}

const ALLOWED: (keyof SettingsPatch)[] = [
  "ach_enabled",
  "card_enabled",
  "pass_card_fee_to_customer",
  "card_fee_percent",
  "ach_preferred_threshold",
  "default_statement_descriptor",
  "surcharge_disclosure",
];

// Reading and writing Stripe settings need the `access_settings`
// permission (admins auto-pass) — mapped 1:1 from the old gate.
export const GET = withRequestContext(
  { permission: "access_settings", serviceClient: true },
  async (_request, ctx) => {
    const { data, error } = await ctx.serviceClient!
      .from("stripe_connection")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ connection: data });
  },
);

export const PATCH = withRequestContext(
  { permission: "access_settings", serviceClient: true },
  async (request, ctx) => {
    const supabase = ctx.serviceClient!;

    const body = (await request.json()) as SettingsPatch;
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        patch[key] = body[key];
      }
    }

    if (patch.default_statement_descriptor && typeof patch.default_statement_descriptor === "string") {
      if ((patch.default_statement_descriptor as string).length > 22) {
        return NextResponse.json({ error: "descriptor_too_long" }, { status: 400 });
      }
    }
    if (typeof patch.card_fee_percent === "number") {
      if (patch.card_fee_percent < 0 || patch.card_fee_percent > 5) {
        return NextResponse.json({ error: "fee_out_of_range" }, { status: 400 });
      }
    }
    if (patch.ach_enabled === false && patch.card_enabled === false) {
      return NextResponse.json({ error: "at_least_one_method_required" }, { status: 400 });
    }
    if (patch.ach_enabled === false || patch.card_enabled === false) {
      const { data: cur } = await supabase
        .from("stripe_connection")
        .select("ach_enabled, card_enabled")
        .limit(1)
        .maybeSingle();
      if (cur) {
        const nextAch = patch.ach_enabled ?? cur.ach_enabled;
        const nextCard = patch.card_enabled ?? cur.card_enabled;
        if (!nextAch && !nextCard) {
          return NextResponse.json({ error: "at_least_one_method_required" }, { status: 400 });
        }
      }
    }

    const { data, error } = await supabase
      .from("stripe_connection")
      .update(patch)
      .neq("id", "00000000-0000-0000-0000-000000000000")
      .select("*")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ connection: data });
  },
);
