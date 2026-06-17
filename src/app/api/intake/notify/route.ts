import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { belongsToActiveOrganization } from "@/lib/request-context/belongs-to-active-organization";
import { dispatchNewIntakeNotifications } from "@/lib/notifications/dispatch-new-intake";

// POST /api/intake/notify — the client calls this best-effort right after an
// Intake's Job is inserted, to fan out the in-app bell to the rest of the
// Organization (see docs/adr/0016-new-intake-push-notifications.md).
//
// Logged-in only: any member who just logged an Intake may trigger its
// notifications. The fan-out itself runs with the Service client (RLS
// bypassed), so this route does the tenant-scoping the database would
// otherwise do — a `jobId` from another Organization is 404, indistinguishable
// from one that does not exist. The submitter is sourced from the session, not
// the body, so a caller cannot spoof who triggered the Intake.
export const POST = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const body = (await request.json().catch(() => ({}))) as { jobId?: unknown };
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const service = ctx.serviceClient!;
    if (!(await belongsToActiveOrganization(service, { jobId }, ctx.orgId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await dispatchNewIntakeNotifications({
      jobId,
      submitterUserId: ctx.userId,
    });

    return NextResponse.json({ ok: true });
  },
);
