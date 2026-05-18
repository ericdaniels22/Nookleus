import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// POST /api/settings/users/[id]/reset-password — generates a password
// recovery link for the target user and returns it for the admin to share.
//
// The link points straight at /set-password on this app (carrying the
// recovery token as a query param), NOT through Supabase's verify-and-
// redirect endpoint. That means it works without any Supabase URL
// configuration or SMTP setup — the admin just hands the link to the user.
//
// Used to onboard crew members created without a password, or to help
// anyone who is locked out.
//
// Logged-in only.
export const POST = withRequestContext(
  { serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const service = ctx.serviceClient!;

    // The link must point at the deployed app, not whatever host served this
    // request. NEXT_PUBLIC_APP_URL is the codebase-wide canonical.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_APP_URL is not set" },
        { status: 500 },
      );
    }

    // Look up the target user's email via the Service client (admin API).
    const { data: userData, error: lookupError } =
      await service.auth.admin.getUserById(id);
    if (lookupError || !userData?.user?.email) {
      return NextResponse.json(
        { error: "Could not find that user's email address" },
        { status: 404 },
      );
    }
    const email = userData.user.email;

    // Generate a recovery token. We use hashed_token to build our own link;
    // the /set-password page verifies it with supabase.auth.verifyOtp().
    const { data: linkData, error: linkError } =
      await service.auth.admin.generateLink({ type: "recovery", email });
    if (linkError || !linkData?.properties?.hashed_token) {
      return NextResponse.json(
        { error: linkError?.message || "Could not generate a reset link" },
        { status: 500 },
      );
    }

    const link =
      `${appUrl}/set-password` +
      `?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}` +
      `&type=recovery`;

    return NextResponse.json({ link, email });
  },
);
