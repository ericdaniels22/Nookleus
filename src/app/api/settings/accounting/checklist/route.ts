// GET  /api/settings/accounting/checklist  — returns checklist items with
//                                              auto-checks computed server-side.
// PATCH /api/settings/accounting/checklist — toggles the manual flags
//                                              (cpa_cleanup_confirmed,
//                                              dry_run_review_confirmed).
//
// Both methods are admin-only and read/write the qb_* tables with the
// Service client (the admin-only RLS policies need not resolve auth.uid()).

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import type { QbConnectionRow, QbMappingRow } from "@/lib/qb/types";

const KNOWN_PAYMENT_METHODS = ["check", "ach", "venmo_zelle", "cash", "credit_card"];

export const GET = withRequestContext(
  { adminOnly: true, serviceClient: true },
  async (_request, ctx) => {
    const service = ctx.serviceClient!;
    const { data: conn } = await service
      .from("qb_connection")
      .select("*")
      .eq("is_active", true)
      .maybeSingle<QbConnectionRow>();
    if (!conn) return NextResponse.json({ items: [] });

    const { data: mappings } = await service
      .from("qb_mappings")
      .select("id, type, platform_value, qb_entity_id, qb_entity_name, created_at, updated_at");
    const all = (mappings ?? []) as QbMappingRow[];

    const { data: damageTypes } = await service.from("damage_types").select("id");
    const damageTypeCount = damageTypes?.length ?? 0;
    const damageMapped = all.filter((m) => m.type === "damage_type").length;
    const methodMapped = all.filter((m) => m.type === "payment_method").length;

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const setupTs = conn.setup_completed_at ? Date.parse(conn.setup_completed_at) : null;
    const dryRunOld = !!(conn.dry_run_mode && setupTs !== null && setupTs <= sevenDaysAgo);

    return NextResponse.json({
      items: [
        {
          key: "cpa_cleanup_confirmed",
          label: "CPA has completed QB cleanup",
          checked: conn.cpa_cleanup_confirmed,
          manual: true,
        },
        {
          key: "damage_mappings",
          label: "Damage type → class mappings complete",
          checked: damageMapped > 0 && damageMapped >= damageTypeCount,
          manual: false,
        },
        {
          key: "method_mappings",
          label: "Payment method → deposit account mappings complete",
          checked: methodMapped >= KNOWN_PAYMENT_METHODS.length,
          manual: false,
        },
        {
          key: "dry_run_7_days",
          label: "Dry run active for 7+ days",
          checked: dryRunOld,
          manual: false,
        },
        {
          key: "dry_run_review_confirmed",
          label: "Would-have-synced log reviewed",
          checked: conn.dry_run_review_confirmed,
          manual: true,
        },
      ],
    });
  },
);

export const PATCH = withRequestContext(
  { adminOnly: true, serviceClient: true },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as {
      cpa_cleanup_confirmed?: boolean;
      dry_run_review_confirmed?: boolean;
    } | null;
    if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

    const service = ctx.serviceClient!;
    const patch: Record<string, unknown> = {};
    if (typeof body.cpa_cleanup_confirmed === "boolean") {
      patch.cpa_cleanup_confirmed = body.cpa_cleanup_confirmed;
    }
    if (typeof body.dry_run_review_confirmed === "boolean") {
      patch.dry_run_review_confirmed = body.dry_run_review_confirmed;
    }

    const { data: conn } = await service
      .from("qb_connection")
      .select("id")
      .eq("is_active", true)
      .maybeSingle<{ id: string }>();
    if (!conn) return NextResponse.json({ error: "no active connection" }, { status: 404 });

    const { error } = await service.from("qb_connection").update(patch).eq("id", conn.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  },
);
