import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import {
  registerDeviceToken,
  type DevicePlatform,
} from "@/lib/notifications/device-tokens";

export const runtime = "nodejs";

// Stores/refreshes the calling device's APNs address. Logged-in only — every
// member registers their own device. Like the notifications route (#119), the
// owner is the authenticated caller (`ctx.userId`) and the write goes through
// the Service client (RLS bypassed): the route must never trust a
// client-supplied user id. No push is sent here — this slice only fills the
// device-address registry. See docs/adr/0016-new-intake-push-notifications.md.
export const POST = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as
      | { token?: unknown; platform?: unknown }
      | null;

    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json(
        { error: "token is required" },
        { status: 400 },
      );
    }

    // iOS is the only platform this slice ships; reject anything else rather
    // than silently storing a token the buzz path can't deliver to.
    const platform = (body?.platform ?? "ios") as DevicePlatform;
    if (platform !== "ios") {
      return NextResponse.json(
        { error: "unsupported platform" },
        { status: 400 },
      );
    }

    // A device address must belong to an Organization (the fan-out scopes by
    // it). A logged-in caller with no Active Organization has nothing to
    // register against.
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "no active organization" },
        { status: 400 },
      );
    }

    try {
      await registerDeviceToken(ctx.serviceClient!, {
        userId: ctx.userId,
        organizationId: ctx.orgId,
        token,
        platform,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "register failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  },
);
