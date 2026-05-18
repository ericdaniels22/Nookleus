import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// POST /api/settings/users/[id]/reset-password — emails the target user a
// password recovery link. Used to onboard crew members who were created
// without a password, or to help anyone who is locked out.
//
// The recovery link lands on /set-password, where the user chooses their
// password. Email delivery depends on Supabase email/SMTP being configured,
// and the /set-password redirect URL must be allowlisted in the Supabase
// Auth "URL Configuration" settings.
//
// Logged-in only.
export const POST = withRequestContext(
  { serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const service = ctx.serviceClient!;

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

    // Trigger the recovery email. Supabase sends its "Reset Password" template
    // with a link back to /set-password on this deployment.
    const redirectTo = new URL("/set-password", request.url).toString();
    const { error: resetError } = await service.auth.resetPasswordForEmail(
      email,
      { redirectTo },
    );
    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, email });
  },
);
