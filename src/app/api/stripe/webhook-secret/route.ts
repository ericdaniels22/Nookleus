import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { encrypt } from "@/lib/encryption";

export const runtime = "nodejs";

interface Body {
  secret: string | null;
}

// Setting the Stripe webhook signing secret needs the `access_settings`
// permission (admins auto-pass) — mapped 1:1 from the old gate.
export const POST = withRequestContext(
  { permission: "access_settings", serviceClient: true },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const secretOrNull = body.secret;
    if (secretOrNull !== null && typeof secretOrNull !== "string") {
      return NextResponse.json(
        { error: "secret must be a string or null" },
        { status: 400 },
      );
    }
    if (typeof secretOrNull === "string" && !secretOrNull.startsWith("whsec_")) {
      return NextResponse.json(
        { error: "secret must start with whsec_" },
        { status: 400 },
      );
    }

    const supabase = ctx.serviceClient!;
    const encryptedOrNull = secretOrNull ? encrypt(secretOrNull) : null;

    const { data: existing } = await supabase
      .from("stripe_connection")
      .select("id")
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (!existing) {
      return NextResponse.json(
        { error: "Connect Stripe before setting the webhook signing secret." },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from("stripe_connection")
      .update({ webhook_signing_secret_encrypted: encryptedOrNull })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  },
);
