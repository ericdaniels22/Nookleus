import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { getActiveConnection } from "@/lib/qb/tokens";

// GET /api/qb/connection — returns the active connection stripped of
// encrypted tokens. Used by the settings page + accounting tab.
async function getConnection(_request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  const conn = await getActiveConnection(service);
  if (!conn) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    id: conn.id,
    realm_id: conn.realm_id,
    company_name: conn.company_name,
    sync_start_date: conn.sync_start_date,
    setup_completed_at: conn.setup_completed_at,
    dry_run_mode: conn.dry_run_mode,
    is_active: conn.is_active,
    last_sync_at: conn.last_sync_at,
    access_token_expires_at: conn.access_token_expires_at,
    refresh_token_expires_at: conn.refresh_token_expires_at,
  });
}

// PATCH /api/qb/connection — updates sync_start_date, dry_run_mode, or
// setup_completed_at. Dry-run can only be flipped true → false (never
// back); start_date can only be set once (when setup_completed_at is null).
async function patchConnection(request: Request, ctx: RequestContext) {
  const body = (await request.json()) as {
    sync_start_date?: string;
    dry_run_mode?: boolean;
    complete_setup?: boolean;
  };

  const service = ctx.serviceClient!;
  const conn = await getActiveConnection(service);
  if (!conn) {
    return NextResponse.json({ error: "no active connection" }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};

  if (body.sync_start_date !== undefined) {
    if (conn.setup_completed_at) {
      return NextResponse.json(
        { error: "sync_start_date is locked after setup completes" },
        { status: 400 },
      );
    }
    patch.sync_start_date = body.sync_start_date;
  }

  if (body.dry_run_mode !== undefined) {
    if (body.dry_run_mode === true && conn.dry_run_mode === false) {
      return NextResponse.json(
        { error: "dry_run_mode cannot be re-enabled on an existing connection" },
        { status: 400 },
      );
    }
    patch.dry_run_mode = body.dry_run_mode;
  }

  if (body.complete_setup === true && !conn.setup_completed_at) {
    // Setup can only complete when both a start date and at least one mapping
    // per required type exist.
    if (!conn.sync_start_date && patch.sync_start_date === undefined) {
      return NextResponse.json(
        { error: "sync_start_date is required before setup can complete" },
        { status: 400 },
      );
    }
    const { count: classCount } = await service
      .from("qb_mappings")
      .select("*", { count: "exact", head: true })
      .eq("type", "damage_type");
    const { count: payCount } = await service
      .from("qb_mappings")
      .select("*", { count: "exact", head: true })
      .eq("type", "payment_method");
    if ((classCount ?? 0) < 1 || (payCount ?? 0) < 1) {
      return NextResponse.json(
        { error: "At least one damage-type and one payment-method mapping are required" },
        { status: 400 },
      );
    }
    patch.setup_completed_at = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error } = await service
    .from("qb_connection")
    .update(patch)
    .eq("id", conn.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, changed: true });
}

export const GET = withRequestContext(
  { adminOnly: true, serviceClient: true },
  getConnection,
);

export const PATCH = withRequestContext(
  { adminOnly: true, serviceClient: true },
  patchConnection,
);
