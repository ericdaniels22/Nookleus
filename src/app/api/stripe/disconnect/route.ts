import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// Disconnecting Stripe needs the `access_settings` permission (admins
// auto-pass) — mapped 1:1 from the old gate.
export const POST = withRequestContext(
  { permission: "access_settings", serviceClient: true },
  async (_request, ctx) => {
    const { error } = await ctx.serviceClient!
      .from("stripe_connection")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  },
);
